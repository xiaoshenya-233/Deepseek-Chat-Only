import { formatDate } from '../../utils/format.js'
import type { TranslationKey } from '../../i18n/index.js'
import * as db from './db.js'
import { replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

import { BackupError } from './history/errors.js'

export { BackupError }

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导入/导出进度上报：界面据此显示进度条。 */
type BackupProgressReporter = (progress: {
  /** 阶段说明的文案 key 与参数 */
  label: { key: TranslationKey; params?: Record<string, number> }
  /** 0–100 */
  percent: number
}) => void

/** 导出为历史会话导出格式的 ZIP，可再次导入。传入 ids 时只导出选中的会话（顺序与列表一致）。 */
export const exportHistory = (
  onProgress?: BackupProgressReporter,
  ids?: readonly string[],
  signal?: AbortSignal
): Promise<{ name: string; blob: Blob; count: number }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    const selected = ids ? sessions.filter((session) => ids.includes(session.id)) : sessions
    const total = selected.length
    onProgress?.({ label: { key: 'backupProgressExportReading', params: { done: 0, total } }, percent: 0 })
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of selected) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const toMb = (bytes: number) => Math.round(bytes / (1024 * 1024))
    let blob: Blob
    try {
      blob = await exportArchive(readSessions(), {
        total,
        signal,
        onProgress: (progress) => {
          if (progress.phase === 'reading') {
            // 读取阶段占前 30%，打包阶段占后 70%：长图片归档的耗时主要在打包
            const percent = total > 0 ? Math.round((progress.done / total) * 30) : 0
            onProgress?.({ label: { key: 'backupProgressExportReading', params: { done: progress.done, total } }, percent })
          } else {
            const doneMb = toMb(progress.done)
            const totalMb = Math.max(1, toMb(progress.total))
            const ratio = progress.total > 0 ? progress.done / progress.total : 0
            onProgress?.({
              label: { key: 'backupProgressExportWriting', params: { done: doneMb, total: totalMb } },
              percent: progress.phase === 'writing' ? 30 + Math.round(ratio * 69) : 0,
            })
          }
        },
      })
    } catch (error) {
      if (signal?.aborted) {
        throw new BackupError('historyExportCancelled')
      }
      throw error
    }
    return { name: backupFileName(now), blob, count: total }
  })

/**
 * 从 DeepSeek 客户端给出的签名下载链接读取历史归档。
 * 只做下载与命名，之后的校验/覆盖确认/导入完全复用文件导入流程。
 * 跨域由外壳补齐（Electron 注入 CORS 头、Android 拦截代理），纯浏览器里链接必须允许跨域。
 */
export const downloadHistoryArchive = async (
  url: string,
  options: { signal?: AbortSignal; onProgress?: BackupProgressReporter } = {}
): Promise<{ file: File; name: string }> => {
  let target: URL
  try {
    target = new URL(url.trim())
  } catch {
    throw new BackupError('historyImportUrlInvalid')
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new BackupError('historyImportUrlInvalid')
  }
  const fromQuery = target.searchParams.get('filename') ?? ''
  const fromPath = target.pathname.split('/').pop() ?? ''
  const name = decodeURIComponent(fromQuery || fromPath || 'deepseek_data.zip')
  if (!/\.zip$/i.test(name)) {
    throw new BackupError('historyImportUrlNotZip')
  }

  let response: Response
  try {
    response = await fetch(target.toString(), {
      signal: options.signal,
      credentials: 'omit',
      redirect: 'follow',
    })
  } catch (error) {
    if (options.signal?.aborted) {
      throw new BackupError('historyImportCancelled')
    }
    // 跨域被拦或网络中断都会走到这里，抛出便于界面提示
    throw new BackupError('historyImportUrlFailed')
  }
  if (!response.ok) {
    throw new BackupError(
      response.status === 403 || response.status === 401
        ? 'historyImportUrlExpired'
        : 'historyImportUrlFailed'
    )
  }

  const total = Number(response.headers.get('content-length')) || 0
  const report = (done: number) => {
    const percent = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0
    options.onProgress?.({
      label: { key: 'backupProgressDownloading', params: { percent } },
      percent,
    })
  }
  options.onProgress?.({
    label: { key: 'backupProgressDownloading', params: { percent: 0 } },
    percent: 0,
  })

  if (!response.body) {
    const blob = await response.blob()
    report(100)
    return { file: new File([blob], name, { type: 'application/zip' }), name }
  }
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let done = 0
  for (;;) {
    const { done: finished, value } = await reader.read()
    if (finished) {
      break
    }
    if (value) {
      chunks.push(value)
      done += value.length
      report(done)
    }
  }
  const blob = new Blob(chunks, { type: 'application/zip' })
  if (blob.size === 0) {
    throw new BackupError('historyImportUrlFailed')
  }
  return { file: new File([blob], name, { type: 'application/zip' }), name }
}

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export const importHistory = (
  file: File,
  options: { signal?: AbortSignal; onProgress?: BackupProgressReporter } = {}
): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    options.onProgress?.({ label: { key: 'backupProgressChecking' }, percent: 0 })
    await checkArchiveFormat(file)
    return replaceHistory(() =>
      importArchive(file, {
        signal: options.signal,
        onProgress: ({ phase, percent, sessions, files }) => {
          options.onProgress?.({
            label:
              phase === 'finalizing'
                ? { key: 'backupProgressFinalizing' }
                : phase === 'files'
                  ? { key: 'backupProgressFiles', params: { count: files } }
                  : phase === 'checking'
                    ? { key: 'backupProgressChecking' }
                    : { key: 'backupProgressSessions', params: { count: sessions } },
            percent,
          })
        },
      })
    )
  })
