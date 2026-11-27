import clsx from 'clsx'
import { useSessionAvatars } from '../../services/chat/assets.js'
import type { SessionSummary } from '../../services/chat/types.js'
import styles from './Casual.module.css'

/** 头像底色按会话 id 稳定散列，避免每次渲染换颜色 */
const avatarHue = (id: string) => {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 360
  }
  return hash
}

const avatarLetter = (title: string) => {
  const first = Array.from(title.trim())[0] ?? '#'
  return first.toUpperCase()
}

/**
 * 会话头像：设置过自定义头像就用图片，否则用标题首字母 + 稳定配色。
 * 同时用于联系人列表、首页置顶话题与休闲模式里 AI 回复的头像。
 */
export const SessionAvatar = ({
  session,
  size = 38,
  className,
}: {
  session: Pick<SessionSummary, 'id' | 'title'>
  size?: number
  className?: string
}) => {
  const url = useSessionAvatars((state) => state.urls[session.id])
  if (url) {
    return (
      <img
        className={clsx(styles.avatar, styles.avatarImage, className)}
        style={{ width: size, height: size }}
        src={url}
        alt=""
        draggable={false}
      />
    )
  }
  return (
    <div
      className={clsx(styles.avatar, className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        ['--avatar-hue' as string]: avatarHue(session.id),
      }}
    >
      {avatarLetter(session.title || '')}
    </div>
  )
}
