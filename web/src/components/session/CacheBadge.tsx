import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import type { MessageUsage } from '../../services/api/types.js'
import {
  activeRounds,
  compressContextNow,
  fitCovered,
  SUMMARY_KEEP_RECENT,
  useSummary,
} from '../../services/chat/summary.js'
import type { Message, Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { showToast } from '../base/toastState.js'
import styles from './CacheBadge.module.css'

/** 最近一次带用量的回复；服务端在 message_delta 里给出全轮累计值 */
export const latestUsage = (messages: Message[]): MessageUsage | null => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'assistant' && message.usage) {
      return message.usage
    }
  }
  return null
}

/** 缓存命中率：命中 token / 全部输入 token（input 不含命中部分，按官方口径相加） */
export const cacheHitRate = (usage: MessageUsage | null): number | null => {
  if (!usage) {
    return null
  }
  const total =
    usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  return total > 0 ? usage.cache_read_input_tokens / total : null
}

/** 千分位，避免长数字挤在一起 */
const formatTokens = (value: number) => value.toLocaleString('en-US')

/**
 * 标题栏的缓存命中率：点击展开说明气泡，显示命中/未命中比例、token 明细与自动摘要状态，
 * 并提供「立即压缩上下文」入口（手动把较早轮次压成摘要，省掉重复发送历史的 token）。
 */
export const CacheBadge = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey ?? '')
  const summary = useSummary(session.id)
  const [open, setOpen] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { side: 'bottom', align: 'end', offset: 6 }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))

  const usage = latestUsage(session.messages)
  const rate = cacheHitRate(usage)
  const percent = rate === null ? null : Math.round(rate * 100)
  const total = usage
    ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
    : 0
  const rounds = activeRounds(session).length
  const covered = fitCovered(rounds, summary)
  const compressible = rounds - SUMMARY_KEEP_RECENT - covered > 0

  if (percent === null && !summary) {
    return null
  }

  const compress = async () => {
    if (compressing) {
      return
    }
    setCompressing(true)
    const result = await compressContextNow(session, apiKey)
    setCompressing(false)
    if (result.ok) {
      showToast(t('contextCompressedToast', { rounds: String(result.rounds) }))
      return
    }
    showToast(
      result.reason === 'no-key'
        ? t('contextCompressNoKey')
        : result.reason === 'empty'
          ? t('contextCompressEmpty')
          : result.reason === 'busy'
            ? t('contextCompressBusy')
            : t('contextCompressFailed')
    )
  }

  const tone =
    percent === null ? 'neutral' : percent >= 70 ? 'good' : percent >= 30 ? 'fair' : 'poor'
  return (
    <>
      <span ref={anchorRef} className={styles.trigger}>
        <button
          type="button"
          className={styles.badge}
          data-tone={tone}
          aria-expanded={open}
          aria-label={t('cachePanelTitle')}
          title={t('cacheBadgeHint')}
          onClick={() => setOpen((value) => !value)}
        >
          {percent === null
            ? t('cacheBadgeEmpty')
            : t('cacheBadgeLabel', { percent: String(percent) })}
        </button>
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              role="dialog"
              aria-label={t('cachePanelTitle')}
              className={clsx(styles.panel, !position && styles.measuring)}
              style={position ?? undefined}
            >
              <div className={styles.panelTitle}>{t('cachePanelTitle')}</div>
              {percent === null ? (
                <p className={styles.note}>{t('cachePanelNoUsage')}</p>
              ) : (
                <>
                  <div className={styles.rates}>
                    <span className={styles.rateGood}>
                      {t('cacheHitRow', { percent: String(percent) })}
                    </span>
                    <span className={styles.ratePoor}>
                      {t('cacheMissRow', { percent: String(100 - percent) })}
                    </span>
                  </div>
                  <div className={styles.tokens}>
                    {t('cacheTokenRow', {
                      hit: formatTokens(usage?.cache_read_input_tokens ?? 0),
                      miss: formatTokens(
                        (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0)
                      ),
                      total: formatTokens(total),
                    })}
                  </div>
                  <div className={styles.tokens}>
                    {t('cacheOutputRow', { output: formatTokens(usage?.output_tokens ?? 0) })}
                  </div>
                </>
              )}
              <p className={styles.note}>{t('cachePanelExplain')}</p>
              <div className={styles.divider} />
              <div className={styles.summaryRow}>
                {summary
                  ? t('cacheSummaryRow', {
                      rounds: String(covered),
                      keep: String(SUMMARY_KEEP_RECENT),
                    })
                  : t('cacheSummaryNone', { keep: String(SUMMARY_KEEP_RECENT) })}
              </div>
              <button
                type="button"
                className={styles.compress}
                disabled={compressing || !compressible}
                onClick={() => void compress()}
              >
                {compressing
                  ? t('contextCompressRunning')
                  : compressible
                    ? t('contextCompressAction')
                    : t('contextCompressIdle')}
              </button>
              <p className={styles.note}>{t('contextCompressHint')}</p>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
