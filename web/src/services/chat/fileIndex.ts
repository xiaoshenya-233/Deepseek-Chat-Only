import * as db from './db.js'
import type { Message, Session } from './types.js'

/**
 * 图片内容的物理去重：同一张图（SHA-256 相同）只保留一份原件、只上传一次。
 *
 * - `fileHashes` 存储记录 `hash → { id, serverId }`，添加附件时先查表：
 *   命中就直接复用旧的附件 id 与 `file_id`，既不重复落库也不重复上传；
 * - 上传成功后把 `file_id` 写回索引，之后同样的图可以直接复用；
 * - `dedupeStoredFiles()` 做一次性清理：把历史里重复的原件合并成一个（改写消息引用），
 *   删除多余 Blob，同时回收没有被任何会话引用的孤儿原件。
 */

/** 去重索引是否可用：`crypto.subtle` 只在安全上下文（Electron 的 app://、https）里存在 */
const canHash = () =>
  typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function'

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** 计算 Blob 的 SHA-256；环境不支持时返回 null（跳过去重，不影响正常使用） */
export const hashBlob = async (blob: Blob): Promise<string | null> => {
  if (!canHash()) {
    return null
  }
  try {
    return toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  } catch {
    return null
  }
}

/** 内存里的新鲜索引：附件落库前（刚添加、还没发送）也能命中 */
const pendingContents = new Map<string, { id: string; serverId?: string }>()

/** 索引命中且原件仍在库里时返回可复用的附件 id 与 file_id */
export const findReusableFile = async (
  hash: string
): Promise<{ id: string; serverId?: string } | null> => {
  // 同一批里刚加入、还没落库的原件也参与复用，避免连续贴同一张图时重复落库
  const pending = pendingContents.get(hash)
  if (pending) {
    return pending
  }
  const record = await db.getFileHash(hash).catch(() => undefined)
  if (!record) {
    return null
  }
  // 原件可能已被删除会话时清掉，索引随之失效
  if (!(await db.hasFile(record.id).catch(() => false))) {
    await db.deleteFileHash(hash).catch(() => {})
    return null
  }
  return { id: record.id, serverId: record.serverId }
}

/** 登记一份内容：`id` 为原件在 files 存储里的主键 */
export const registerFileContent = async ({
  id,
  hash,
  size,
  serverId,
}: {
  id: string
  hash: string
  size: number
  serverId?: string
}): Promise<void> => {
  pendingContents.set(hash, { id, serverId })
  await db
    .putFileHash({ hash, id, serverId, size, createdAt: Date.now() })
    .catch(() => {})
}

/**
 * 上传成功后把 file_id 写进该附件对应的哈希记录，
 * 之后同一份内容再次添加时可以直接复用，不再上传。
 */
export const rememberServerId = async (id: string, serverId: string): Promise<void> => {
  for (const [hash, entry] of pendingContents) {
    if (entry.id === id) {
      pendingContents.set(hash, { id, serverId })
    }
  }
  try {
    const records = await db.loadFileHashesByFileId(id)
    for (const record of records) {
      if (record.serverId === serverId) {
        continue
      }
      await db.putFileHash({ ...record, serverId })
    }
  } catch {
    // 索引写失败不影响上传结果
  }
}

/**
 * 补传前先查内容索引：同样内容的图片以前上传过就直接复用它的 file_id。
 * 命中时顺便把这份内容与当前的附件 id 关联起来，方便下次直接命中。
 */
export const reuseServerIdForBlob = async (
  blob: Blob,
  id: string
): Promise<string | null> => {
  const hash = await hashBlob(blob)
  if (!hash) {
    return null
  }
  const reusable = await findReusableFile(hash).catch(() => null)
  if (reusable?.serverId) {
    if (reusable.id !== id) {
      await registerFileContent({ id, hash, size: blob.size, serverId: reusable.serverId })
    }
    return reusable.serverId
  }
  return null
}

/** 一次性清理是否已执行过（只在首次启动做全量扫描） */
export const FILE_DEDUPE_FLAG = 'chat-demo:file-dedupe-v1'

export type DedupeStats = {
  /** 扫描过的原件数 */
  scanned: number
  /** 合并掉的重复原件数 */
  merged: number
  /** 回收的孤儿原件数 */
  orphans: number
  /** 改写的附件引用数 */
  remapped: number
  /** 实际删除的 Blob 数 */
  removed: number
}

/** 首次启动时执行一次清理；结果写进标记，之后不再全量扫描 */
export const runFileDedupeOnce = async (): Promise<DedupeStats | null> => {
  try {
    if (localStorage.getItem(FILE_DEDUPE_FLAG)) {
      return null
    }
  } catch {
    return null
  }
  const stats = await dedupeStoredFiles()
  try {
    localStorage.setItem(FILE_DEDUPE_FLAG, JSON.stringify({ ...stats, at: Date.now() }))
  } catch {
    // 标记写不进去最多下次再扫一遍，不影响正确性
  }
  return stats
}

const emptyStats = (): DedupeStats => ({
  scanned: 0,
  merged: 0,
  orphans: 0,
  remapped: 0,
  removed: 0,
})

/** 收集所有消息引用过的附件 id 与它的 serverId */
const collectRefs = (sessions: Session[]) => {
  const refs = new Map<string, string | null>()
  for (const session of sessions) {
    for (const message of session.messages) {
      if (message.role !== 'user') {
        continue
      }
      for (const file of message.files) {
        if (!refs.get(file.id)) {
          refs.set(file.id, file.serverId ?? null)
        }
      }
    }
  }
  return refs
}

/**
 * 全量清理：把重复的图片原件合并成一份，改写消息里的附件引用并删除多余 Blob，
 * 顺便回收没有被任何会话引用的孤儿原件。启动时执行一次即可，失败不影响使用。
 */
export const dedupeStoredFiles = async (): Promise<DedupeStats> => {
  const stats = emptyStats()
  if (!canHash()) {
    return stats
  }
  const ids = await db.loadFileIds()
  if (ids.length === 0) {
    return stats
  }
  // 1) 逐个读取原件并计算哈希：一次只持有一份 Blob，避免把整库原图读进内存
  const byHash = new Map<string, string[]>()
  const sizes = new Map<string, number>()
  for (const id of ids) {
    const record = await db.loadStoredFile(id).catch(() => undefined)
    if (!record) {
      continue
    }
    stats.scanned += 1
    let hash = record.hash
    if (!hash) {
      hash = (await hashBlob(record.blob)) ?? undefined
      if (hash) {
        // 回写哈希，下次清理无需重算
        await db.putStoredFile({ id: record.id, blob: record.blob, hash }).catch(() => {})
      }
    }
    if (!hash) {
      continue
    }
    sizes.set(id, record.blob.size)
    const group = byHash.get(hash)
    if (group) {
      group.push(id)
    } else {
      byHash.set(hash, [id])
    }
  }

  const sessions = await db.loadAllSessions()
  const refs = collectRefs(sessions)
  const canonical = new Map<string, string>()
  for (const [hash, group] of byHash) {
    // 优先保留仍被会话引用的那份，减少改写
    const keep = group.find((id) => refs.has(id)) ?? group[0]
    const reuseServerId = group.map((id) => refs.get(id)).find((value) => value) ?? undefined
    // 每个哈希都登记索引（哪怕只有一份）：以后再次添加同一张图可以直接复用这份原件
    await db
      .putFileHash({
        hash,
        id: keep,
        serverId: reuseServerId,
        size: sizes.get(keep) ?? 0,
        createdAt: Date.now(),
      })
      .catch(() => {})
    for (const id of group) {
      if (id !== keep) {
        canonical.set(id, keep)
        stats.merged += 1
      }
    }
  }

  // 2) 改写消息里的附件引用；同一轮里重复贴的同一张图也合并成一条
  const changed: Session[] = []
  if (canonical.size > 0) {
    for (const session of sessions) {
      let dirty = false
      const messages: Message[] = session.messages.map((message) => {
        if (message.role !== 'user' || message.files.length === 0) {
          return message
        }
        let changedHere = false
        const seen = new Set<string>()
        const files = message.files.flatMap((file) => {
          const nextId = canonical.get(file.id) ?? file.id
          if (seen.has(nextId)) {
            changedHere = true
            stats.remapped += 1
            return []
          }
          seen.add(nextId)
          if (nextId === file.id) {
            return [file]
          }
          changedHere = true
          stats.remapped += 1
          return [{ ...file, id: nextId }]
        })
        if (!changedHere) {
          return message
        }
        dirty = true
        return { ...message, files }
      })
      if (dirty) {
        changed.push({ ...session, messages })
      }
    }
    await db.saveSessionsBulk(changed).catch(() => {})
  }

  // 3) 删除重复原件与无人引用的孤儿原件
  const referenced = new Set<string>()
  for (const session of changed.length > 0 ? changed : sessions) {
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          referenced.add(file.id)
        }
      }
    }
  }
  const removable = new Set<string>(canonical.keys())
  for (const id of ids) {
    // 已按重复合并处理的 id 不再重复计入孤儿
    if (canonical.has(id) || referenced.has(id)) {
      continue
    }
    removable.add(id)
    stats.orphans += 1
  }
  for (const id of removable) {
    await db.deleteFile(id).catch(() => {})
    stats.removed += 1
  }
  // 索引里指向已删除原件的记录一并清掉，避免下次添加时先命中失效索引再回删
  for (const record of await db.loadFileHashes().catch(() => [])) {
    if (removable.has(record.id)) {
      await db.deleteFileHash(record.hash).catch(() => {})
    }
  }
  return stats
}

