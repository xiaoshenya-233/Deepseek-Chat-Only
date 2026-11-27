import { create } from 'zustand'

/**
 * 置顶会话：只影响本地列表顺序，不写进历史对话 ZIP（官方格式没有稳定的置顶语义），
 * 和提示词一样存在 localStorage。
 */
const KEY = 'chat-demo:pinned-sessions'

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}

export const useSessionPins = create<{ pins: string[] }>(() => ({ pins: read() }))

const write = (pins: string[]) => {
  try {
    if (pins.length === 0) {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, JSON.stringify(pins))
    }
  } catch {
    // 隐私模式下写入失败时仍保留内存里的值
  }
  useSessionPins.setState({ pins })
}

export const setSessionPinned = (sessionId: string, pinned: boolean) => {
  const current = useSessionPins.getState().pins
  const rest = current.filter((id) => id !== sessionId)
  write(pinned ? [sessionId, ...rest] : rest)
}

/** 删除会话时一并清掉置顶记录 */
export const removeSessionPins = (ids: string[]) => {
  const removed = new Set(ids)
  const current = useSessionPins.getState().pins
  const pins = current.filter((id) => !removed.has(id))
  if (pins.length !== current.length) {
    write(pins)
  }
}
