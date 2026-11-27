import clsx from 'clsx'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import logoUrl from '../../assets/logo.png'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, selectSession, useChatStore } from '../../services/chat/store.js'
import { addToCasualHome, isOnCasualHome } from '../../services/chat/activity.js'
import type { Session, SessionSummary } from '../../services/chat/types.js'
import { useSessionPins } from '../../services/chat/pins.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import {
  IconChatOutline16,
  IconDataOutline16,
  IconListOutline16,
  IconSettingsOutline16,
  IconSearchOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { SessionView } from '../session/SessionView.js'
import { Welcome } from '../session/Welcome.js'
import { CasualChatColumn, CasualMobileHome } from './CasualHome.js'
import { CasualPreview } from './CasualPreview.js'
import { CasualRow } from './CasualRow.js'
import styles from './Casual.module.css'

/** 休闲模式的三个页面：桌面端是左侧导航栏，移动端是底部导航 */
type CasualTab = 'chats' | 'contacts' | 'settings'

/** 分组标签在跨天/切回页面时刷新，避免「今天」一直停在昨天 */
const useSessionClock = () => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return now
}

/** 会话页：搜索 + 置顶区 + 按时间分组的全部对话 */
export const CasualContacts = ({
  selectedId,
  onPreview,
}: {
  /** 当前高亮的会话（桌面端是右侧预览的那个） */
  selectedId?: string
  /** 桌面端：点击行只切换右侧预览，不直接打开对话 */
  onPreview?: (sessionId: string) => void
} = {}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const pins = useSessionPins((state) => state.pins)
  const now = useSessionClock()
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const pinnedIds = useMemo(() => new Set(pins), [pins])
  const keyword = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!keyword) {
      return sessions
    }
    return sessions.filter((session) =>
      (session.title || t('untitledChat')).toLowerCase().includes(keyword)
    )
  }, [sessions, keyword, t])
  const pinnedSessions = useMemo(
    () => matches.filter((session) => pinnedIds.has(session.id)),
    [matches, pinnedIds]
  )
  const groups = useMemo(
    () => groupSessions(matches.filter((session) => !pinnedIds.has(session.id)), now, t),
    [matches, pinnedIds, now, t]
  )
  const highlightId = selectedId ?? activeId

  return (
    <aside className={styles.contacts}>
      <div className={styles.contactsTop}>
        <div className={styles.contactsBrand}>
          <span className={styles.contactsTitle}>{t('casualContactsTitle')}</span>
          <span className={styles.contactsCount}>{sessions.length}</span>
        </div>
        <IconButton
          size="m"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          tooltipPlacement="bottom"
          aria-label={t('newChat')}
          onClick={newChat}
        />
      </div>
      <label className={styles.search}>
        <span className={styles.searchIcon}>
          <IconSearchOutline16 />
        </span>
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          placeholder={t('casualSessionSearch')}
          aria-label={t('casualSessionSearch')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.list}>
        {pinnedSessions.length > 0 ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t('casualPinnedSection')}</div>
            {pinnedSessions.map((session) => (
              <CasualRow
                key={session.id}
                session={session}
                active={session.id === highlightId}
                pinned
                onDelete={() => setDeleting(session)}
                onOpen={onPreview ? () => onPreview(session.id) : undefined}
              />
            ))}
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} className={styles.section}>
            <div className={styles.sectionTitle}>{group.label}</div>
            {group.sessions.map((session) => (
              <CasualRow
                key={session.id}
                session={session}
                active={session.id === highlightId}
                pinned={false}
                onDelete={() => setDeleting(session)}
                onOpen={onPreview ? () => onPreview(session.id) : undefined}
              />
            ))}
          </div>
        ))}
        {matches.length === 0 ? (
          <div className={styles.listEmpty}>
            {sessions.length === 0 ? t('casualEmptyList') : t('casualSearchEmpty')}
          </div>
        ) : null}
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </aside>
  )
}
const NavItem = ({
  active,
  icon,
  label,
  onClick,
  variant,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  variant: 'rail' | 'tab'
}) => (
  <button
    type="button"
    className={clsx(variant === 'rail' ? styles.railItem : styles.tabItem, active && styles.tabItemActive)}
    aria-current={active ? 'page' : undefined}
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </button>
)

/**
 * 休闲模式外壳：
 * - 桌面端：最左侧竖向导航栏「聊天 / 会话 / 设置」，设置固定在最下方；右侧是主区
 * - 移动端：同样的三个页面，导航放在底部
 * 聊天页 = 主页（置顶 + 常用），会话页 = 全部对话，设置页 = 常用入口。
 */
export const CasualShell = ({
  session,
  streaming,
  loadingSessionId = null,
  loadError = false,
}: {
  session: Session | undefined
  streaming: boolean
  /** 正在读取的会话：只让右侧主区显示加载态，导航与列表保持不动 */
  loadingSessionId?: string | null
  loadError?: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<CasualTab>('chats')
  const [composing, setComposing] = useState(false)
  /** 桌面端「会话」页右侧预览的会话 id，不改变当前打开的会话 */
  const [previewId, setPreviewId] = useState<string | null>(null)
  const activeId = session?.id ?? null
  const previewSession = useChatStore((state) =>
    previewId === null ? undefined : state.sessions.find((item) => item.id === previewId)
  )

  useEffect(() => {
    if (activeId) {
      setComposing(false)
      setTab('chats')
      setPreviewId(null)
    }
  }, [activeId])

  /** 点「聊天」时如果正在看某个会话，回到主页；进「会话」时默认预览当前对话 */
  const selectTab = (next: CasualTab) => {
    if (next === 'chats' && activeId !== null) {
      newChat()
    }
    if (next === 'contacts') {
      setPreviewId(activeId)
    }
    setTab(next)
  }

  /** 预览里的「继续聊天」：上首页 + 打开会话，其余区域不重建 */
  const continuePreview = (id: string) => {
    if (!isOnCasualHome(id)) {
      addToCasualHome(id)
      showToast({ key: 'casualHomeAddedHint' })
    }
    setPreviewId(null)
    selectSession(id)
  }

  const items: { key: CasualTab; label: string; icon: ReactNode }[] = [
    { key: 'chats', label: t('casualTabChats'), icon: <IconChatOutline16 /> },
    { key: 'contacts', label: t('casualTabContacts'), icon: <IconListOutline16 /> },
    { key: 'settings', label: t('casualTabSettings'), icon: <IconSettingsOutline16 /> },
  ]

  /** 只在右侧主区里显示加载态，会话列表和导航保持挂载 */
  const loadingPane = (id: string) => (
    <div className={styles.paneLoading} role="status" aria-live="polite">
      <span>{loadError ? t('sessionLoadFailed') : t('sessionLoading')}</span>
      {loadError ? (
        <Button variant="outlined" size="m" onClick={() => selectSession(id)}>
          {t('retry')}
        </Button>
      ) : null}
    </div>
  )

  /** mobileView：移动端单栏；桌面端列表在左侧栏，主区直接用带输入框的欢迎页 */
  const renderPane = (mobileView: boolean) => {
    if (tab === 'settings') {
      return <CasualSettings />
    }
    if (loadingSessionId) {
      return loadingPane(loadingSessionId)
    }
    if (session) {
      return (
        <SessionView
          session={session}
          streaming={streaming}
          siderCollapsed={false}
          casual
          onBack={mobileView ? newChat : undefined}
        />
      )
    }
    if (composing) {
      return <Welcome />
    }
    if (mobileView) {
      return <CasualMobileHome onStart={() => setComposing(true)} onOpen={() => setTab('chats')} />
    }
    return <Welcome message={t('casualHomeGreeting')} />
  }

  /** 桌面端主区：会话页显示右侧预览，其余页面沿用 renderPane */
  const renderMainPane = () => {
    if (tab !== 'contacts') {
      return renderPane(false)
    }
    if (loadingSessionId) {
      return loadingPane(loadingSessionId)
    }
    if (previewSession) {
      return (
        <CasualPreview
          key={previewSession.id}
          session={previewSession}
          onContinue={() => continuePreview(previewSession.id)}
        />
      )
    }
    return <div className={styles.previewEmpty}>{t('casualPreviewPick')}</div>
  }

  if (isMobile) {
    return (
      <div className={styles.shell}>
        <section className={styles.pane}>
          {tab === 'contacts' ? <CasualContacts /> : renderPane(true)}
        </section>
        {/*
         * 进入对话后只保留顶部的返回栏：底部导航和输入框抢同一块屏幕，
         * 键盘弹出时更挤；返回箭头（onBack → newChat）已经能回到主页。
         */}
        {session ? null : (
          <nav className={styles.tabBar} aria-label={t('uiModeCasual')}>
            {items.map((item) => (
              <NavItem
                key={item.key}
                variant="tab"
                active={tab === item.key}
                icon={item.icon}
                label={item.label}
                onClick={() => selectTab(item.key)}
              />
            ))}
          </nav>
        )}
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label={t('uiModeCasual')}>
        <div className={styles.railGroup}>
          {items.slice(0, 2).map((item) => (
            <NavItem
              key={item.key}
              variant="rail"
              active={tab === item.key}
              icon={item.icon}
              label={item.label}
              onClick={() => selectTab(item.key)}
            />
          ))}
        </div>
        <div className={styles.railGroup}>
          <NavItem
            variant="rail"
            active={tab === 'settings'}
            icon={items[2].icon}
            label={items[2].label}
            onClick={() => selectTab('settings')}
          />
        </div>
      </nav>
      {tab === 'settings' ? null : (
        <div className={styles.listColumn}>
          {tab === 'contacts' ? (
            <CasualContacts selectedId={previewId ?? undefined} onPreview={setPreviewId} />
          ) : (
            <CasualChatColumn
              onOpen={() => setTab('chats')}
              onStart={() => setComposing(true)}
            />
          )}
        </div>
      )}
      <section className={styles.pane}>{renderMainPane()}</section>
    </div>
  )
}

/** 设置页：只放常用入口，具体开关仍在原有设置弹窗（含界面模式）里 */
const CasualSettings = () => {
  const t = useTranslate()
  return (
    <div className={styles.settingsPane}>
      <div className={styles.settingsPaneTitle}>{t('settings')}</div>
      <button type="button" className={styles.settingsItem} onClick={() => openSettings('general')}>
        <IconSettingsOutline16 />
        <span>{t('settingsSectionGeneral')}</span>
      </button>
      <button type="button" className={styles.settingsItem} onClick={() => openSettings('data')}>
        <IconDataOutline16 />
        <span>{t('settingsSectionData')}</span>
      </button>
    </div>
  )
}

/**
 * 首次进入（数据库还在初始化）时的骨架：保持导航栏 + 居中 logo 的布局，
 * 避免休闲模式下先闪一下效率模式的空白页。
 */
export const CasualSkeleton = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.shell}>
      {isMobile ? null : (
        <nav className={styles.rail} aria-hidden="true">
          <div className={styles.railGroup}>
            <div className={styles.skeletonRailItem} />
            <div className={styles.skeletonRailItem} />
          </div>
          <div className={styles.railGroup}>
            <div className={styles.skeletonRailItem} />
          </div>
        </nav>
      )}
      <section className={styles.pane}>
        <div className={styles.skeletonPane} role="status" aria-live="polite">
          <img className={styles.homeLogo} src={logoUrl} alt="" aria-hidden="true" />
          <div className={styles.skeletonText}>{t('sessionLoading')}</div>
        </div>
      </section>
    </div>
  )
}