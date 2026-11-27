import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { BackupError, downloadHistoryArchive } from '../../services/chat/backup.js'
import {
  beginBackupProgress,
  finishBackupProgress,
  updateBackupProgress,
} from '../backup/backupProgressState.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './ImportByUrlDialog.module.css'

/**
 * 从链接导入：粘贴 DeepSeek 客户端导出对话时给出的签名下载链接，
 * 下载 ZIP 后交给已有的「覆盖确认 → 导入」流程（不在本弹窗内直接导入）。
 */
export const ImportByUrlDialog = ({
  onClose,
  onPicked,
}: {
  onClose: () => void
  onPicked: (file: File) => void
}) => {
  const t = useTranslate()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const submit = async () => {
    const value = url.trim()
    if (!value || busy) {
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError(null)
    beginBackupProgress('backupProgressDownloadingTitle', () => controller.abort())
    try {
      const { file } = await downloadHistoryArchive(value, {
        signal: controller.signal,
        onProgress: ({ label, percent }) => updateBackupProgress(label, percent),
      })
      finishBackupProgress('done')
      onPicked(file)
      onClose()
    } catch (failure) {
      finishBackupProgress('error')
      setError(
        failure instanceof BackupError
          ? t(failure.key)
          : failure instanceof Error && failure.message
            ? failure.message
            : t('historyImportUrlFailed')
      )
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('historyImportFromUrlTitle')}
      closable
      className={styles.dialog}
      onClose={() => {
        // 下载中不关闭，避免用户以为已取消；进度条上的取消按钮会中止请求
        if (!busy) {
          onClose()
        }
      }}
      footer={
        <>
          <Button variant="outlined" size="m" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="m" disabled={busy || url.trim().length === 0} onClick={() => void submit()}>
            {busy ? t('historyImportFromUrlDownloading') : t('historyImportFromUrlAction')}
          </Button>
        </>
      }
    >
      <p className={styles.hint}>{t('historyImportFromUrlHint')}</p>
      <input
        className={styles.input}
        type="url"
        inputMode="url"
        autoFocus
        spellCheck={false}
        value={url}
        placeholder={t('historyImportFromUrlPlaceholder')}
        aria-label={t('historyImportFromUrlHint')}
        disabled={busy}
        onChange={(event) => setUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={styles.note}>{t('historyImportConfirmDescription')}</p>
      )}
    </Modal>
  )
}
