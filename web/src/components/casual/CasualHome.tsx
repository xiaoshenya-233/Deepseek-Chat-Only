import { useMemo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { hideFromCasualHome, useCasualSessions } from '../../services/chat/activity.js'
import { useSessionPins } from '../../services/chat/pins.js'
import { useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { NewChatIcon } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { CasualRow } from './CasualRow.js'
import styles from './Casual.module.css'

/** 主页「常用会话」最多展示的数量 */
const MAX_FREQUENT = 6

/** 聊天页要展示的两组会话：置顶 + 常用（只统计真正发过消息的） */
export const useCasualHomeSessions = () => {
  const sessions = useChatStore((state) => state.sessions)
  const pins = useSessionPins((state) => state.pins)
  const activity = useCasualSessions((state) => state.activity)
  const hidden = useCasualSessions((state) => state.hidden)

  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const hiddenSet = useMemo(() => new Set(hidden), [hidden])
  const pinned = useMemo(
    () =>
      pins
        .map((id) => byId.get(id))
        .filter((session): session is SessionSummary => Boolean(session))
        .filter((session) => !hiddenSet.has(session.id)),
    [pins, byId, hiddenSet]
  )
  const pinnedIds = useMemo(() => new Set(pinned.map((session) => session.id)), [pinned])
  const frequent = useMemo(
    () =>
      activity
        .filter((id) => !hiddenSet.has(id) && !pinnedIds.has(id))
        .map((id) => byId.get(id))
        .filter((session): session is SessionSummary => Boolean(session))
        .slice(0, MAX_FREQUENT),
    [activity, hiddenSet, pinnedIds, byId]
  )
  return { pinned, frequent }
}

/** 置顶 + 常用两组列表（主页与桌面端列表栏共用） */
export const CasualSessionList = ({
  pinned,
  frequent,
  onOpen,
}: {
  pinned: SessionSummary[]
  frequent: SessionSummary[]
  onOpen?: (id: string) => void
}) => {
  const t = useTranslate()
  const activeId = useChatStore((state) => state.activeId)
  const hide = (session: SessionSummary) => {
    hideFromCasualHome(session.id)
    showToast({ key: 'casualHomeHiddenHint' })
  }
  return (
    <>
      {pinned.length > 0 ? (
        <section className={styles.homeSection}>
          <div className={styles.homeSectionTitle}>{t('casualPinnedSection')}</div>
          <div className={styles.topicList}>
            {pinned.map((session) => (
              <CasualRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                pinned
                onHide={() => hide(session)}
                onNavigate={() => onOpen?.(session.id)}
              />
            ))}
          </div>
        </section>
      ) : null}
      {frequent.length > 0 ? (
        <section className={styles.homeSection}>
          <div className={styles.homeSectionTitle}>{t('casualFrequent')}</div>
          <div className={styles.topicList}>
            {frequent.map((session) => (
              <CasualRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                pinned={false}
                onHide={() => hide(session)}
                onNavigate={() => onOpen?.(session.id)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}

/**
 * 桌面端「聊天」页的左侧列表栏：置顶 + 常用会话。
 * 点击某一项后由外层把会话显示在右侧内嵌聊天页里。
 */
export const CasualChatColumn = ({ onOpen, onStart }: { onOpen?: (id: string) => void; onStart: () => void }) => {
  const t = useTranslate()
  const { pinned, frequent } = useCasualHomeSessions()
  const empty = pinned.length === 0 && frequent.length === 0
  return (
    <aside className={styles.chatColumn}>
      <div className={styles.chatColumnTop}>
        <span className={styles.chatColumnTitle}>{t('casualTabChats')}</span>
        <IconButton
          size="m"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          tooltipPlacement="bottom"
          aria-label={t('newChat')}
          onClick={onStart}
        />
      </div>
      <div className={styles.chatColumnScroll}>
        <CasualSessionList pinned={pinned} frequent={frequent} onOpen={onOpen} />
        {empty ? (
          <div className={styles.homeEmpty}>
            <div className={styles.homeEmptyTitle}>{t('casualHomeEmptyTitle')}</div>
            <div className={styles.homeEmptyHint}>{t('casualHomeEmptyHint')}</div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

/**
 * 移动端「聊天」页：顶部标题栏（含新对话按钮）+ 置顶/常用列表。
 * 移动端不再显示大 logo 与欢迎语，空状态只留提示。
 */
export const CasualMobileHome = ({
  onStart,
  onOpen,
}: {
  onStart: () => void
  onOpen?: (id: string) => void
}) => {
  const t = useTranslate()
  const { pinned, frequent } = useCasualHomeSessions()
  const empty = pinned.length === 0 && frequent.length === 0
  return (
    <div className={styles.mobileHome}>
      <div className={styles.mobileTopBar}>
        <span className={styles.chatColumnTitle}>{t('casualTabChats')}</span>
        <IconButton
          size="m"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          tooltipPlacement="bottom"
          aria-label={t('newChat')}
          onClick={onStart}
        />
      </div>
      <div className={styles.mobileScroll}>
        <CasualSessionList pinned={pinned} frequent={frequent} onOpen={onOpen} />
        {empty ? (
          <div className={styles.homeEmpty}>
            <div className={styles.homeEmptyTitle}>{t('casualHomeEmptyTitle')}</div>
            <div className={styles.homeEmptyHint}>{t('casualHomeEmptyHint')}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}