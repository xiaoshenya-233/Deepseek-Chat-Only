import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 13

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
  /** 内容 SHA-256（图片才有，用于物理去重）；缺省表示尚未计算 */
  hash?: string
}

/** 内容哈希索引：同一份内容只保留一条记录，指向仍在库里的附件 id 与它上传得到的 file_id */
export type FileHashRecord = {
  hash: string
  /** 复用的附件 id（files 存储的主键） */
  id: string
  /** 已上传时记录的 file_id，重复内容直接复用，不再上传 */
  serverId?: string
  size: number
  createdAt: number
}

/** 会话自定义头像（id = 会话 id），同时用于休闲模式列表与该会话内 AI 回复的头像 */
export type AvatarRecord = {
  id: string
  blob: Blob
}

/** 用户表情包：上传图片后压缩保存，发送时作为图片附件走同一条上传链路 */
export type StickerRecord = {
  id: string
  blob: Blob
  createdAt: number
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
  /** 会话自定义头像：与消息内容无关，替换会话数据时保留 */
  sessionAvatars: { key: string; value: AvatarRecord }
  /** 用户表情包 */
  stickers: { key: string; value: StickerRecord }
  /** 图片内容哈希 → 复用附件 id / file_id，用于物理去重 */
  fileHashes: {
    key: string
    value: FileHashRecord
    indexes: { fileId: string }
  }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of [
        'sessions',
        'files',
        'sessionsStaging',
        'filesStaging',
        'sessionAvatars',
        'stickers',
      ] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
      const hashes = db.objectStoreNames.contains('fileHashes')
        ? tx.objectStore('fileHashes')
        : db.createObjectStore('fileHashes', { keyPath: 'hash' })
      if (!hashes.indexNames.contains('fileId')) {
        hashes.createIndex('fileId', 'id')
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await (await getDB()).getAll('sessionSummaries')).map(toSessionSummary)

export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await getDB()).get('sessions', id)

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = storedSummary(session)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(session)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          session.title = title
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 附件原件是否还在库里（去重前确认索引没有指向已删除的原件） */
export const hasFile = async (id: string): Promise<boolean> =>
  (await (await getDB()).count('files', id)) > 0

/** 全部原件 id（不读 Blob，避免一次性把整库原图读进内存） */
export const loadFileIds = async (): Promise<string[]> => (await getDB()).getAllKeys('files')

export const loadStoredFile = async (id: string): Promise<StoredFile | undefined> =>
  (await getDB()).get('files', id)

export const deleteFile = async (id: string): Promise<void> => {
  await (await getDB()).delete('files', id)
}

/** 写入一个原件（可带 hash），供去重后的迁移使用 */
export const putStoredFile = async (file: StoredFile): Promise<void> => {
  await (await getDB()).put('files', file)
}

/** 读取/写入/删除内容哈希索引 */
export const loadFileHashes = async (): Promise<FileHashRecord[]> =>
  (await getDB()).getAll('fileHashes')

export const getFileHash = async (hash: string): Promise<FileHashRecord | undefined> =>
  (await getDB()).get('fileHashes', hash)

export const putFileHash = async (record: FileHashRecord): Promise<void> => {
  await (await getDB()).put('fileHashes', record)
}

export const deleteFileHash = async (hash: string): Promise<void> => {
  await (await getDB()).delete('fileHashes', hash)
}

/** 同一个附件 id 对应的哈希记录（上传成功后把 file_id 写进索引） */
export const loadFileHashesByFileId = async (id: string): Promise<FileHashRecord[]> =>
  (await getDB()).getAllFromIndex('fileHashes', 'fileId', id)

/** 全部会话详情与带 fileIds 的摘要，去重迁移时要改写消息里的附件引用 */
export const loadAllSessions = async (): Promise<Session[]> => (await getDB()).getAll('sessions')

export const loadStoredSummaries = async (): Promise<StoredSessionSummary[]> =>
  (await getDB()).getAll('sessionSummaries')

/** 批量写回会话与其摘要（迁移用，不触碰原件） */
export const saveSessionsBulk = async (sessions: Session[]): Promise<void> => {
  if (sessions.length === 0) {
    return
  }
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const session of sessions) {
          await tx.objectStore('sessions').put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 */
export const commitStaging = async (): Promise<SessionSummary[]> => {
  const summaries: SessionSummary[] = []
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      await target.clear()
      if (to === 'sessions') {
        await tx.objectStore('sessionSummaries').clear()
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        await target.put(cursor.value)
        if (to === 'sessions') {
          const summary = storedSummary(cursor.value as Session)
          await tx.objectStore('sessionSummaries').put(summary)
          summaries.push(toSessionSummary(summary))
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交清空和部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  return summaries
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}

/** 会话自定义头像：读取全部、写入/清除单个会话 */
export const loadSessionAvatars = async (): Promise<AvatarRecord[]> =>
  (await getDB()).getAll('sessionAvatars')

export const saveSessionAvatar = async (id: string, blob: Blob): Promise<void> => {
  await (await getDB()).put('sessionAvatars', { id, blob })
}

export const deleteSessionAvatar = async (id: string): Promise<void> => {
  await (await getDB()).delete('sessionAvatars', id)
}

/** 表情包：读取全部（按创建时间倒序）、新增、删除 */
export const loadStickers = async (): Promise<StickerRecord[]> => {
  const records = (await getDB()).getAll('stickers')
  return (await records).sort((a, b) => b.createdAt - a.createdAt)
}

export const saveSticker = async (record: StickerRecord): Promise<void> => {
  await (await getDB()).put('stickers', record)
}

export const deleteSticker = async (id: string): Promise<void> => {
  await (await getDB()).delete('stickers', id)
}
