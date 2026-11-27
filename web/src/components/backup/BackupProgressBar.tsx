import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { requestCancelBackup, useBackupProgress } from './backupProgressState.js'
import styles from './BackupProgressBar.module.css'

/**
 * 导入/导出的进度条：固定在窗口底部居中，关闭设置弹窗后仍然可见。
 * 进行中可取消（在下一个归档条目边界停止，原有数据不变）。
 */
export const BackupProgressBar = () => {
  const t = useTranslate()
  const open = useBackupProgress((state) => state.open)
  const titleKey = useBackupProgress((state) => state.titleKey)
  const label = useBackupProgress((state) => state.label)
  const percent = useBackupProgress((state) => state.percent)
  const outcome = useBackupProgress((state) => state.outcome)
  const cancelling = useBackupProgress((state) => state.cancelling)
  if (!open) {
    return null
  }
  const failed = outcome === 'error'
  const title =
    outcome === 'done'
      ? `${t(titleKey)} · ${t('backupProgressDone')}`
      : failed
        ? t('backupProgressFailed')
        : outcome === 'cancelled'
          ? `${t(titleKey)} · ${t('backupProgressCancelled')}`
          : t(titleKey)
  return (
    <div className={styles.wrap}>
      <div className={clsx(styles.card, failed && styles.failed)} role="status" aria-live="polite">
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          {outcome === 'running' ? (
            <button
              type="button"
              className={styles.cancel}
              disabled={cancelling}
              onClick={requestCancelBackup}
            >
              {cancelling ? t('backupProgressCancelled') : t('backupProgressCancel')}
            </button>
          ) : null}
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className={styles.bar} style={{ width: `${percent}%` }} />
        </div>
        <div className={styles.meta}>
          <span>{t(label.key, label.params)}</span>
          <span>{percent}%</span>
        </div>
      </div>
    </div>
  )
}
