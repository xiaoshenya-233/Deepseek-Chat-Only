import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setSessionPinned } from '../../services/chat/pins.js'
import { addToCasualHome, useCasualSessions } from '../../services/chat/activity.js'
import { showToast } from '../base/toastState.js'
import { clearSessionAvatar, useSessionAvatars } from '../../services/chat/assets.js'
import { pickAvatarFor } from '../../services/chat/avatarEditor.js'
import { useSettings } from '../../services/settings.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import { PREVIEW_LABELS, useSessionPreview } from '../../services/chat/preview.js'
import type { SessionSummary } from '../../services/chat/types.js'
import {
  IconCloseOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconImageOutline16,
  IconPinOutline16,
  IconTrashOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { SessionAvatar } from './SessionAvatar.js'
import styles from './Casual.module.css'

const pad = (value: number) => String(value).padStart(2, '0')

/** 联系人列表里的时间：今天显示时分，今年显示月日，跨年显示年月日 */
const formatChatTime = (time: number, locale: string) => {
  const date = new Date(time)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return locale === 'en-US'
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/** 闲聊模式的「联系人」行：头像 + 标题 + 时间，菜单里置顶/重命名/删除 */
export const CasualRow = memo(function CasualRow({
  session,
  active,
  pinned,
  onDelete,
  onNavigate,
  onHide,
  onOpen,
}: {
  session: SessionSummary
  active: boolean
  pinned: boolean
  onDelete?: () => void
  onNavigate?: () => void
  /** 聊天主页上的行：提供「从聊天主页移除」（不删除数据） */
  onHide?: () => void
  /** 覆盖默认的「打开会话」：桌面端会话页用它切到右侧预览 */
  onOpen?: () => void
}) {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const hasAvatar = useSessionAvatars((state) => Boolean(state.urls[session.id]))
  // 会话是否已经在聊天主页（在常用名单里且没被移除）：决定菜单显示「添加」还是「移除」
  const onHome = useCasualSessions(
    (state) => state.activity.includes(session.id) && !state.hidden.includes(session.id)
  )
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')
  // 第二行：最后一条消息的预览（图片/脑图等只显示类型）
  const preview = useSessionPreview(session.id, session.updatedAt)
  const previewText = preview ? (preview.kind === 'text' ? preview.text : t(PREVIEW_LABELS[preview.kind])) : ''
  /** 默认打开会话；会话页会传入 onOpen，改为在右侧预览 */
  const open = () => {
    if (onOpen) {
      onOpen()
      return
    }
    selectSession(session.id)
    onNavigate?.()
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.row, active && styles.rowActive)}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
    >
      <span
        className={styles.avatarButton}
        onClick={(event) => {
          event.stopPropagation()
          pickAvatarFor(session.id, displayTitle)
        }}
      >
        <SessionAvatar session={{ id: session.id, title: displayTitle }} />
      </span>
      <div className={styles.rowText}>
        <div className={styles.rowTop}>
          <span className={styles.rowTitle}>{displayTitle}</span>
          <span className={styles.rowTime}>{formatChatTime(session.updatedAt, locale)}</span>
        </div>
        {pinned || previewText ? (
          <div className={styles.rowBottom}>
            {pinned ? (
              <span className={styles.rowPin} role="img" aria-label={t('sessionHistoryTimelineLabelPinned')}>
                <IconPinOutline16 />
              </span>
            ) : null}
            {previewText ? <span className={styles.rowPreview}>{previewText}</span> : null}
          </div>
        ) : null}
      </div>
      <div className={styles.rowAction} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'avatar',
              label: t('sessionAvatarSet'),
              icon: <IconImageOutline16 />,
              onSelect: () => pickAvatarFor(session.id, displayTitle),
            },
            ...(hasAvatar
              ? [
                  {
                    key: 'avatar-clear',
                    label: t('sessionAvatarClear'),
                    icon: <IconTrashOutline16 />,
                    onSelect: () => void clearSessionAvatar(session.id),
                  },
                ]
              : []),
            ...(onHome
              ? onHide
                ? [
                    {
                      key: 'hide',
                      label: t('casualHideSession'),
                      icon: <IconCloseOutline16 />,
                      onSelect: onHide,
                    },
                  ]
                : []
              : [
                  {
                    key: 'add-home',
                    label: t('casualAddSession'),
                    icon: <NewChatIcon />,
                    onSelect: () => {
                      addToCasualHome(session.id)
                      showToast({ key: 'casualHomeAddedHint' })
                    },
                  },
                ]),
            {
              key: 'pin',
              label: t(pinned ? 'sessionItemMenuUnpinOption' : 'sessionItemMenuPinOption'),
              icon: <IconPinOutline16 />,
              onSelect: () => setSessionPinned(session.id, !pinned),
            },
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            ...(onDelete
              ? [
                  {
                    key: 'delete',
                    label: t('delete'),
                    icon: <IconTrashOutline16 />,
                    danger: true as const,
                    onSelect: onDelete,
                  },
                ]
              : []),
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
