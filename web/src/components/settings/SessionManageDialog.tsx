import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { formatDate } from '../../utils/format.js'
import { BackupError, exportHistory } from '../../services/chat/backup.js'
import { removeSessions, useChatStore } from '../../services/chat/store.js'
import {
  beginBackupProgress,
  finishBackupProgress,
  updateBackupProgress,
} from '../backup/backupProgressState.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './SessionManageDialog.module.css'

/**
 * 瀵硅瘽绠＄悊锛氬彧绠″璇濇湰韬€斺€旇嚜鐢遍€夋嫨瀵煎嚭銆佹壒閲忓垹闄ゃ€?
 * 鎻愮ず璇嶇浉鍏虫搷浣滃湪鐙珛鐨勩€屾彁绀鸿瘝绠＄悊銆嶏紙PromptManageDialog锛夐噷锛岄伩鍏嶄袱绉嶅鍑烘贩娣嗐€?
 * mode=export 鏃跺鍑哄畬鎴愬悗鑷姩鍏抽棴锛沵ode=manage 鏃跺仠鐣欏湪鍒楄〃閲岀户缁搷浣溿€?
 */
export type SessionManageMode = 'manage'

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const SessionManageDialog = ({
  onClose,
}: {
  onClose: () => void
}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const [query, setQuery] = useState('')
  // 瀵煎嚭榛樿鍏ㄩ€夛紙娌跨敤鍘熸潵鈥滃叏閮ㄥ鍑衡€濈殑琛屼负锛夛紝鍒犻櫎榛樿涓嶉€?
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      keyword
        ? sessions.filter((session) =>
            (session.title || t('untitledChat')).toLowerCase().includes(keyword)
          )
        : sessions,
    [sessions, keyword, t]
  )
  const allSelected = filtered.length > 0 && filtered.every((session) => selected.has(session.id))

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      for (const session of filtered) {
        if (allSelected) {
          next.delete(session.id)
        } else {
          next.add(session.id)
        }
      }
      return next
    })
  }

  const onExport = async () => {
    if (selected.size === 0 || busy) {
      return
    }
    const controller = new AbortController()
    setBusy(true)
    setStatus(null)
    // 打包大归档可能耗时：进度条上的「取消」会中止读取/写入，界面不会假死
    beginBackupProgress('backupProgressExporting', () => controller.abort())
    try {
      const { name, blob, count } = await exportHistory(
        ({ label, percent }) => updateBackupProgress(label, percent),
        [...selected],
        controller.signal
      )
      finishBackupProgress('done')
      download(blob, name)
      setStatus(t('historyExportDone', { count }))
    } catch (error) {
      if (error instanceof BackupError && error.key === 'historyExportCancelled') {
        finishBackupProgress('cancelled')
        setStatus(t('historyExportCancelled'))
      } else {
        finishBackupProgress('error')
        const reason =
          error instanceof BackupError
            ? t(error.key)
            : error instanceof Error
              ? error.message
              : String(error)
        setStatus(t('historyExportFailed', { message: reason }))
      }
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (selected.size === 0 || busy) {
      return
    }
    setBusy(true)
    try {
      const { removed, failed } = await removeSessions([...selected])
      setConfirming(false)
      setSelected(new Set())
      if (failed > 0) {
        showToast({ key: 'sessionManageDeleteFailed', params: { count: failed }, type: 'error' })
      } else {
        showToast({ key: 'sessionManageDeleted', params: { count: removed } })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        title={t('sessionManageTitle')}
        closable
        className={styles.dialog}
        mainClassName={styles.main}
        onClose={() => {
          if (!busy) {
            onClose()
          }
        }}
        footer={
          <>
            <Button
              variant="dangerOutlined"
              size="m"
              disabled={busy || selected.size === 0}
              onClick={() => setConfirming(true)}
            >
              {t('sessionManageDeleteAction')}
              {selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
            <span className={styles.spacer} />
            <Button variant="outlined" size="m" disabled={busy} onClick={onClose}>
              {t('sessionManageDone')}
            </Button>
            <Button
              size="m"
              disabled={busy || selected.size === 0}
              onClick={() => void onExport()}
            >
              <IconDownloadOutline16 />
              {t('sessionManageExportAction')}
              {selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
          </>
        }
      >
        <div className={styles.toolbar}>
          <input
            className={styles.search}
            value={query}
            placeholder={t('sessionManageSearch')}
            aria-label={t('sessionManageSearch')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="s" variant="outlined" disabled={filtered.length === 0} onClick={toggleAll}>
            {allSelected ? t('sessionManageSelectNone') : t('sessionManageSelectAll')}
          </Button>
        </div>
        {status ? <div className={styles.status}>{status}</div> : null}
        <div className={styles.selection}>
          {t('sessionManageSelected', { count: selected.size, total: sessions.length })}
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            {sessions.length === 0 ? t('sessionManageEmpty') : t('promptsManagerNone')}
          </div>
        ) : (
          <ul className={styles.list}>
            {filtered.map((session) => {
              const title = session.title || t('untitledChat')
              return (
                <li key={session.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selected.has(session.id)}
                      aria-label={title}
                      onChange={() => toggle(session.id)}
                    />
                    <div className={styles.rowText}>
                      <div className={styles.rowTitle} title={title}>
                        {title}
                      </div>
                      <div className={clsx(styles.excerpt, styles.unset)}>
                        {t('sessionManageUpdated', {
                          date: formatDate(new Date(session.updatedAt)) ?? '',
                        })}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      {confirming ? (
        <Modal
          title={t('sessionManageDeleteTitle')}
          className={styles.confirm}
          onClose={() => {
            if (!busy) {
              setConfirming(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                autoFocus
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
                {t('sessionManageDeleteAction')}
              </Button>
            </>
          }
        >
          {t('sessionManageDeleteDescription', { count: selected.size })}
        </Modal>
      ) : null}
    </>
  )
}

