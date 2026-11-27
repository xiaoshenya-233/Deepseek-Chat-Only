import { create } from 'zustand'
import { compressImageForStorage } from '../../utils/compressImage.js'
import { createId } from '../../utils/id.js'
import * as db from './db.js'

/**
 * 会话头像与表情包：图片统一先过 `compressImageForStorage`（长边 2560 / 1.2 MiB 预算），
 * 原件存 IndexedDB，界面用 object URL 展示；URL 在替换/删除时释放。
 */
export const useSessionAvatars = create<{ urls: Record<string, string>; ready: boolean }>(() => ({
  urls: {},
  ready: false,
}))

export type Sticker = {
  id: string
  blob: Blob
  url: string
  createdAt: number
}

export const useStickers = create<{ items: Sticker[]; ready: boolean }>(() => ({
  items: [],
  ready: false,
}))

let avatarInit: Promise<void> | null = null
let stickerInit: Promise<void> | null = null

export const initSessionAvatars = () =>
  (avatarInit ??= (async () => {
    try {
      const records = await db.loadSessionAvatars()
      const urls: Record<string, string> = {}
      for (const record of records) {
        urls[record.id] = URL.createObjectURL(record.blob)
      }
      useSessionAvatars.setState({ urls, ready: true })
    } catch {
      useSessionAvatars.setState({ ready: true })
    }
  })())

export const initStickers = () =>
  (stickerInit ??= (async () => {
    try {
      const records = await db.loadStickers()
      useStickers.setState({
        items: records.map((record) => ({
          id: record.id,
          blob: record.blob,
          url: URL.createObjectURL(record.blob),
          createdAt: record.createdAt,
        })),
        ready: true,
      })
    } catch {
      useStickers.setState({ ready: true })
    }
  })())

/** 设置会话头像：压缩后落库，并替换界面上的 object URL */
export const setSessionAvatar = async (sessionId: string, file: File): Promise<void> => {
  const compressed = await compressImageForStorage(file).catch(() => file)
  await db.saveSessionAvatar(sessionId, compressed)
  const urls = { ...useSessionAvatars.getState().urls }
  const previous = urls[sessionId]
  urls[sessionId] = URL.createObjectURL(compressed)
  useSessionAvatars.setState({ urls })
  if (previous) {
    URL.revokeObjectURL(previous)
  }
}

export const clearSessionAvatar = async (sessionId: string): Promise<void> => {
  await db.deleteSessionAvatar(sessionId)
  const current = useSessionAvatars.getState().urls
  const previous = current[sessionId]
  useSessionAvatars.setState({
    urls: Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)),
  })
  if (previous) {
    URL.revokeObjectURL(previous)
  }
}

/** 新增表情包：图片自动压缩后保存 */
export const addSticker = async (file: File): Promise<Sticker> => {
  const compressed = await compressImageForStorage(file).catch(() => file)
  const record: db.StickerRecord = {
    id: createId(),
    blob: compressed,
    createdAt: Date.now(),
  }
  await db.saveSticker(record)
  const sticker: Sticker = {
    ...record,
    url: URL.createObjectURL(compressed),
  }
  useStickers.setState((state) => ({ items: [sticker, ...state.items] }))
  return sticker
}

export const removeSticker = async (id: string): Promise<void> => {
  await db.deleteSticker(id)
  const items = useStickers.getState().items
  const target = items.find((item) => item.id === id)
  useStickers.setState({ items: items.filter((item) => item.id !== id) })
  if (target) {
    URL.revokeObjectURL(target.url)
  }
}
