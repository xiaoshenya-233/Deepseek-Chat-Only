import { create } from 'zustand'
import type { TranslationKey } from '../../i18n/index.js'

type BackupOutcome = 'running' | 'done' | 'error' | 'cancelled'

type Label = { key: TranslationKey; params?: Record<string, number> }

type State = {
  open: boolean
  titleKey: TranslationKey
  label: Label
  percent: number
  outcome: BackupOutcome
  /** 已请求取消，等待当前读写步骤结束 */
  cancelling: boolean
}

const IDLE: State = {
  open: false,
  titleKey: 'backupProgressImporting',
  label: { key: 'backupProgressChecking' },
  percent: 0,
  outcome: 'running',
  cancelling: false,
}

export const useBackupProgress = create<State>(() => IDLE)

/** 当前任务的取消回调；导入时由 AbortController 提供 */
let cancelHandler: (() => void) | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const clearHide = () => {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** 开始一次导入/导出：显示进度条并注册取消回调。 */
export const beginBackupProgress = (
  titleKey: TranslationKey,
  onCancel?: () => void
) => {
  clearHide()
  cancelHandler = onCancel ?? null
  useBackupProgress.setState({
    open: true,
    titleKey,
    label: { key: titleKey === 'backupProgressExporting' ? 'backupProgressExportReading' : 'backupProgressChecking' },
    percent: 0,
    outcome: 'running',
    cancelling: false,
  })
}

export const updateBackupProgress = (label: Label, percent: number) => {
  const { outcome } = useBackupProgress.getState()
  if (outcome !== 'running') {
    return
  }
  useBackupProgress.setState({ label, percent: Math.max(0, Math.min(100, percent)) })
}

/** 结束进度条：完成后短暂停留再收起，失败与取消保留更久便于阅读。 */
export const finishBackupProgress = (outcome: Exclude<BackupOutcome, 'running'>) => {
  cancelHandler = null
  useBackupProgress.setState({
    outcome,
    cancelling: false,
    percent: outcome === 'done' ? 100 : useBackupProgress.getState().percent,
    ...(outcome === 'done' ? { label: { key: 'backupProgressDone' } } : {}),
  })
  clearHide()
  hideTimer = setTimeout(
    () => useBackupProgress.setState(IDLE),
    outcome === 'done' ? 900 : 2400
  )
}

/** 点击取消：只发出信号，读写循环在下一个条目边界停止。 */
export const requestCancelBackup = () => {
  if (cancelHandler === null) {
    return
  }
  useBackupProgress.setState({ cancelling: true })
  cancelHandler()
}
