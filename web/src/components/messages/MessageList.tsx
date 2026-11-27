import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { onJumpToMessage } from './messageJump.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 首屏只挂载最新 10 条；上滑到顶部再追加 10 条 */
const PAGE_SIZE = 10
/** 同时挂载的上限：回到最底部时回收更早的节点，避免长对话越滚越慢 */
const MAX_RENDERED = 60
/** 距顶部小于该值时加载更早的消息 */
const LOAD_MORE_THRESHOLD = 120
/** 会话总览跳转时挂载的上下文：目标前 3 条、后 7 条，够看清落点又不至于一次渲染太多 */
const JUMP_BEFORE = 3
const JUMP_AFTER = 7
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  streaming,
  footer,
  casual = false,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
  /** 休闲模式：AI 回复带会话头像与气泡 */
  casual?: boolean
}) => {
  const isMobile = useIsMobile()
  const t = useTranslate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  /**
   * 渲染窗口 [start, start + size)，单位是当前会话的消息下标。
   * 停在底部时窗口贴住末尾；跳到很早的消息时只挂载目标附近一小段，
   * 避免长会话一次渲染上百条（Markdown 解析 + 布局）导致掉帧。
   */
  const [windowRange, setWindowRange] = useState(() => ({
    start: Math.max(0, messages.length - PAGE_SIZE),
    size: Math.min(PAGE_SIZE, messages.length),
  }))
  const windowRef = useRef(windowRange)
  windowRef.current = windowRange
  /** 是否停在底部：仅用于「回到底部」按钮的显隐，滚动逻辑仍以 stickyRef 为准 */
  const [atBottom, setAtBottom] = useState(true)
  const totalRef = useRef(messages.length)
  totalRef.current = messages.length
  /** 会话总览点击的跳转目标；目标可能还没挂载，等扩大挂载范围后再定位 */
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const pendingJumpRef = useRef<string | null>(null)
  /** 追加更早消息前的滚动高度，用于保持阅读位置 */
  const pendingPrependRef = useRef<number | null>(null)
  /** 向下补页要裁掉顶部时，记下首条可见消息，重排后按它补偿滚动 */
  const pendingAnchorRef = useRef<{ id: string; offset: number } | null>(null)
  /** 正在逐帧续页，避免重复启动 */
  const extendingRef = useRef(false)
  /** 上次加载更早消息的时间，用于节流 */
  const lastLoadRef = useRef(0)

  /** 上滑到接近顶部时追加一页；用 ref 取总数，避免闭包里的旧值 */
  const loadMore = useCallback(() => {
    if (windowRef.current.start === 0) {
      return
    }
    const el = scrollRef.current
    pendingPrependRef.current = el ? el.scrollHeight : null
    setWindowRange((range) => {
      const grow = Math.min(PAGE_SIZE, range.start)
      return { start: range.start - grow, size: Math.min(range.size + grow, MAX_RENDERED) }
    })
  }, [])

  /** 跳到中间后继续往下看：追加一页；超过上限时裁掉顶部并用锚点补偿，返回是否还有更多 */
  const extendWindow = useCallback(() => {
    const el = scrollRef.current
    const range = windowRef.current
    const total = totalRef.current
    if (!el || range.start + range.size >= total) {
      return false
    }
    const grow = Math.min(PAGE_SIZE, total - (range.start + range.size))
    const overflow = Math.max(0, range.size + grow - MAX_RENDERED)
    if (overflow > 0) {
      const bounds = el.getBoundingClientRect()
      const node = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(
        (item) => item.getBoundingClientRect().bottom > bounds.top
      )
      if (node?.dataset.messageId) {
        pendingAnchorRef.current = {
          id: node.dataset.messageId,
          offset: node.getBoundingClientRect().top - bounds.top,
        }
      }
    }
    setWindowRange({ start: range.start + overflow, size: range.size + grow - overflow })
    return true
  }, [])

  /** 逐帧续页：每帧只挂一页并贴底，既连续又不会一次性大渲染 */
  const extendToEnd = useCallback(() => {
    if (extendingRef.current) {
      return
    }
    extendingRef.current = true
    const step = () => {
      const el = scrollRef.current
      if (!extendingRef.current || !el) {
        extendingRef.current = false
        return
      }
      if (!extendWindow()) {
        extendingRef.current = false
        stickyRef.current = true
        setAtBottom(true)
        return
      }
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [extendWindow])

  /** 补偿滚动会再触发一次 scroll 事件，节流避免一次上滑连跳好几页 */
  const loadMoreThrottled = useCallback(() => {
    const now = Date.now()
    if (now - lastLoadRef.current < 400) {
      return
    }
    lastLoadRef.current = now
    loadMore()
  }, [loadMore])

  // 切换会话：回到最新一页
  useLayoutEffect(() => {
    const total = totalRef.current
    setWindowRange({ start: Math.max(0, total - PAGE_SIZE), size: Math.min(PAGE_SIZE, total) })
    pendingPrependRef.current = null
    pendingJumpRef.current = null
    setAtBottom(true)
  }, [session.id])

  // 追加更早消息后补偿滚动高度，保持当前阅读位置；回收后重新贴底
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    const anchor = pendingAnchorRef.current
    if (anchor) {
      pendingAnchorRef.current = null
      const node = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`)
      if (node) {
        el.scrollTop +=
          node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset
        scrollTopRef.current = el.scrollTop
      }
      return
    }
    const previous = pendingPrependRef.current
    if (previous !== null) {
      pendingPrependRef.current = null
      el.scrollTop += el.scrollHeight - previous
      scrollTopRef.current = el.scrollTop
      return
    }
    if (stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [windowRange.start, windowRange.size])
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  /** 回到底部：恢复跟随状态并平滑滚到最新一条（按钮点击） */
  const jumpToBottom = useCallback(() => {
    stickyRef.current = true
    setAtBottom(true)
    const el = scrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    // 窗口可能因为跳转停在中间：新消息进来时贴回末尾
    const total = totalRef.current
    setWindowRange((range) => {
      const size = Math.min(range.size, total)
      const start = Math.max(0, total - size)
      return range.start === start && range.size === size ? range : { start, size }
    })
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  // 会话总览：先确保目标消息被挂载（可能还在分页之外），再交给下面的布局动效定位
  useEffect(
    () =>
      onJumpToMessage((messageId) => {
        const index = messagesRef.current.findIndex((message) => message.id === messageId)
        if (index < 0) {
          return
        }
        const total = totalRef.current
        pendingJumpRef.current = messageId
        stickyRef.current = false
        /**
         * 只挂载目标前后一小段：原来「从目标一直挂到末尾」在长会话里会一次渲染上百条消息，
         * Markdown / 公式 / 图表全部要解析一遍，跳转必然卡顿。
         */
        const start = Math.max(0, index - JUMP_BEFORE)
        setWindowRange({
          start,
          size: Math.min(total - start, JUMP_BEFORE + JUMP_AFTER + 1),
        })
      }),
    []
  )

  // 目标消息挂载后滚到视口顶部附近，并短暂高亮，避免「跳过去了却不知道落在哪里」
  useLayoutEffect(() => {
    const messageId = pendingJumpRef.current
    const el = scrollRef.current
    if (!messageId || !el) {
      return
    }
    const target = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
    if (!target) {
      return
    }
    pendingJumpRef.current = null
    /*
     * 更早的消息带 content-visibility: auto，挂载瞬间用的是估算高度（contain-intrinsic-size），
     * 首帧定位会偏几百像素。这里在接下来两帧与真实排版完成后再校正，直到落点误差 < 1px。
     */
    const align = () => {
      if (!target.isConnected) {
        return
      }
      const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
      if (Math.abs(delta) > 1) {
        el.scrollTop += delta
        scrollTopRef.current = el.scrollTop
      }
    }
    align()
    const frame = requestAnimationFrame(() => {
      align()
      requestAnimationFrame(align)
    })
    const timer = window.setTimeout(align, 240)
    setAtBottom(false)
    target.setAttribute('data-dsc-jump', '1')
    const clearHighlight = window.setTimeout(() => target.removeAttribute('data-dsc-jump'), 1400)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      window.clearTimeout(clearHighlight)
    }
  }, [session.id, windowRange.start, windowRange.size])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      const range = windowRef.current
      const total = totalRef.current
      const atWindowEnd = range.start + range.size >= total
      setAtBottom(nearBottom && atWindowEnd)
      // 接近顶部时加载更早的一页
      if (el.scrollTop < LOAD_MORE_THRESHOLD && range.start > 0) {
        loadMoreThrottled()
      }
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom && !atWindowEnd) {
        // 窗口还没到末尾：滚到底就逐帧续页，一直补到真正的最末尾
        extendToEnd()
      } else if (nearBottom) {
        stickyRef.current = true
        // 回到底部时回收更早挂载的节点，长对话不会越滚越慢
        if (range.size > MAX_RENDERED) {
          setWindowRange({
            start: Math.max(0, total - MAX_RENDERED),
            size: Math.min(MAX_RENDERED, total),
          })
        }
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [extendToEnd, isMobile, loadMoreThrottled, scrollToBottom])

  const total = messages.length
  const start = Math.min(windowRange.start, Math.max(0, total - 1))
  const shown = messages.slice(start, start + windowRange.size)
  const lastIndex = total - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div className={styles.listArea}>
        <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div ref={contentRef} className={styles.column}>
              {shown.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={start + index === 0}
                    isLast={start + index === lastIndex || start + index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    isLast={start + index === lastIndex}
                    streaming={streaming && start + index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                    casual={casual}
                    avatarSession={casual ? session : undefined}
                  />
                )
              )}
            </div>
          </div>
          {footer}
        </div>
        {/* 上滑离开底部时浮出：一键回到最新消息，生成中带脉冲点 */}
        {atBottom || messages.length === 0 ? null : (
          <button
            type="button"
            className={styles.jumpButton}
            aria-label={t('backToBottom')}
            title={t('backToBottom')}
            onClick={jumpToBottom}
          >
            <IconChevronDownOutline14 />
            {streaming ? <span className={styles.jumpDot} /> : null}
          </button>
        )}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
