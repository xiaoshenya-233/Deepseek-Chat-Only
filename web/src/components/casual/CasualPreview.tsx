import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { loadSession } from '../../services/chat/db.js'
import {
  buildLatestMessageView,
  PREVIEW_LABELS,
  type LatestMessageView,
} from '../../services/chat/preview.js'
import type { Session, SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Markdown } from '../markdown/Markdown.js'
import { SessionAvatar } from './SessionAvatar.js'
import styles from './Casual.module.css'

const pad = (value: number) => String(value).padStart(2, '0')

const formatTime = (time: number) => {
  const date = new Date(time)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 桌面端「会话」页右侧的预览：上方显示最新一条消息，下方是「继续聊天」。
 * 点击列表只切换预览，不会立刻打开对话，避免会话页被瞬间替换。
 */
export const CasualPreview = ({
  session,
  onContinue,
}: {
  session: SessionSummary
  onContinue: () => void
}) => {
  const t = useTranslate()
  const [loaded, setLoaded] = useState<Session | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(null)
    setFailed(false)
    void loadSession(session.id)
      .then((stored) => {
        if (!cancelled) {
          setLoaded(stored ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session.id])

  const latest: LatestMessageView | null = loaded ? buildLatestMessageView(loaded) : null
  const label =
    latest && latest.preview && latest.preview.kind !== 'text'
      ? t(PREVIEW_LABELS[latest.preview.kind])
      : null

  return (
    <div className={styles.previewPane}>
      <div className={styles.previewTop}>
        <SessionAvatar session={{ id: session.id, title: session.title || t('untitledChat') }} />
        <div className={styles.previewHead}>
          <div className={styles.previewTitle}>{session.title || t('untitledChat')}</div>
          <div className={styles.previewMeta}>
            {latest
              ? `${latest.role === 'user' ? t('casualPreviewFromYou') : t('casualPreviewLatest')} · ${formatTime(latest.createdAt)}`
              : formatTime(session.updatedAt)}
          </div>
        </div>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewLabel}>{t('casualPreviewLatest')}</div>
        {!loaded && !failed ? (
          <div className={styles.previewHint}>{t('casualPreviewLoading')}</div>
        ) : null}
        {failed ? <div className={styles.previewHint}>{t('sessionLoadFailed')}</div> : null}
        {loaded && !latest ? <div className={styles.previewHint}>{t('casualPreviewEmpty')}</div> : null}
        {latest?.text ? (
          latest.role === 'assistant' ? (
            <Markdown
              content={latest.text}
              loading={false}
              cacheKey={`casual-preview:${session.id}:${latest.createdAt}`}
              className={styles.previewMarkdown}
              disableLink={false}
            />
          ) : (
            <div className={styles.previewText}>{latest.text}</div>
          )
        ) : label ? (
          <div className={styles.previewText}>{label}</div>
        ) : null}
      </div>
      <div className={styles.previewFooter}>
        <Button size="l" onClick={onContinue}>
          {t('casualPreviewContinue')}
        </Button>
      </div>
    </div>
  )
}