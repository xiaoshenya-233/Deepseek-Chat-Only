import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSessionPrompt } from '../../services/chat/prompts.js'
import type { Session } from '../../services/chat/types.js'
import { IconEditOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { CacheBadge } from './CacheBadge.js'
import { MobileHeader } from './MobileHeader.js'
import { SessionOutline } from './SessionOutline.js'
import { SessionPromptDialog } from './SessionPromptDialog.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
  casual = false,
  onBack,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
  /** 休闲模式：AI 回复用头像 + 气泡样式 */
  casual?: boolean
  onBack?: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const [promptOpen, setPromptOpen] = useState(false)
  /** 输入框（含底部提示）实测高度：悬浮按钮贴在它上方，不压住输入框 */
  const inputRef = useRef<HTMLDivElement>(null)
  const [composerHeight, setComposerHeight] = useState(0)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) {
      return
    }
    const observer = new ResizeObserver(() => setComposerHeight(el.getBoundingClientRect().height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [isMobile, session.id])
  const hasPrompt = useSessionPrompt(session.id) !== ''
  const cacheBadge = <CacheBadge session={session} />
  // 对话总览只在效率模式出现：休闲模式已有联系人列表 + 最新消息预览
  const outlineButton = casual ? null : <SessionOutline session={session} />
  const promptButton = (
    <IconButton
      size={isMobile ? 'xl' : undefined}
      tone={isMobile ? 'primary' : undefined}
      className={isMobile ? undefined : clsx(styles.promptButton, hasPrompt && styles.promptSet)}
      icon={<IconEditOutline16 />}
      aria-label={hasPrompt ? t('sessionPromptActive') : t('sessionPrompt')}
      tooltip={hasPrompt ? t('sessionPromptActive') : t('sessionPrompt')}
      tooltipPlacement="bottom"
      onClick={() => setPromptOpen(true)}
    />
  )
  return (
    <div
      className={styles.view}
      style={{ '--dsc-composer-height': `${composerHeight}px` } as React.CSSProperties}
    >
      {isMobile ? (
        <MobileHeader
          title={title}
          action={
            <>
              {cacheBadge}
              {promptButton}
            </>
          }
          onBack={onBack}
        />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.actions}>
            {cacheBadge}
            {outlineButton}
            {promptButton}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        casual={casual}
        footer={
          <div ref={inputRef} className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
      {isMobile && !casual ? <SessionOutline session={session} variant="float" /> : null}
      <SessionPromptDialog
        sessionId={session.id}
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
      />
    </div>
  )
}
