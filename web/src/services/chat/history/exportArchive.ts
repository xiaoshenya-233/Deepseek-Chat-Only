import * as db from '../db.js'
import type { Session } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import { writeArchive } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 官方导出里的 user.json 是脱敏的账号信息。本地不保存账号，这里只写同结构的空占位，
 * 让 ZIP 与 DeepSeek 官方导出的条目顺序/字段保持一致（导入端本来就会跳过它）。
 */
const USER_PLACEHOLDER = {
  user_id: null,
  email: null,
  mobile: null,
  oauth_profiles: [],
}

/** 让出主线程：长导出时进度条能刷新、取消按钮可点 */
const yieldToUi = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })

type ExportProgress =
  | { phase: 'reading'; done: number; total: number }
  | { phase: 'writing'; done: number; total: number }

/**
 * 按导出格式生成 ZIP：manifest → user → 全部会话 JSON → index → 全部图片，
 * 与 DeepSeek 官方导出的条目顺序一致。只写出本地有原件的图片，每个会话目录各写一份；
 * 其他附件只有元数据。读取与打包之间会主动让出主线程，并支持中途取消。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  options: {
    /** 会话总数，用于读取阶段的进度 */
    total?: number
    signal?: AbortSignal
    onProgress?: (progress: ExportProgress) => void
  } = {}
): Promise<Blob> => {
  const { signal, onProgress } = options
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  const loadUser = () => json(USER_PLACEHOLDER)
  const entries = [
    { name: MANIFEST_PATH, blob: json(manifest) },
    { name: USER_PATH, blob: loadUser() },
  ]
  const imageEntries: { name: string; blob: Blob }[] = []
  const index: SessionIndexEntry[] = []
  const originals = new Map<string, Blob | undefined>()
  let done = 0
  const total = options.total ?? 0
  for await (const session of sessions) {
    signal?.throwIfAborted()
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          if (file.isImage && !originals.has(file.id)) {
            signal?.throwIfAborted()
            originals.set(file.id, await db.loadFile(file.id))
          }
        }
      }
    }
    const images = new Map<string, Blob>()
    const data = toSessionFile(session, ({ id, name, isImage }) => {
      const blob = originals.get(id)
      if (!blob || !isImage) {
        return null
      }
      const path = imagePath(session.id, id, name)
      images.set(path, blob)
      return path
    })
    entries.push({ name: sessionPath(session.id), blob: json(data) })
    for (const [name, blob] of images) {
      imageEntries.push({ name, blob })
    }
    index.push(toIndexEntry(data))
    done += 1
    onProgress?.({ phase: 'reading', done, total })
    // 每处理完一个会话让出一次主线程：几百个会话时界面不会假死
    await yieldToUi()
  }
  signal?.throwIfAborted()
  entries.push({ name: INDEX_PATH, blob: json(index) })
  return writeArchive(entries.concat(imageEntries), {
    signal,
    onProgress: (written, expected) => onProgress?.({ phase: 'writing', done: written, total: expected }),
  })
}

