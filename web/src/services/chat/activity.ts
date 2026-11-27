import { create } from 'zustand'

/**
 * 休闲模式主页的「活跃度」与「隐藏」记录：
 * - activity：真正发过消息的会话（导入但没聊过的不算），最近使用的排在最前；
 * - hidden：用户从聊天主页移除的会话，数据仍保留，在「会话」里再发一条消息就会回到主页。
 * 全部存 localStorage，跟置顶、提示词保持一致（不进官方导出 ZIP）。
 */
const ACTIVITY_KEY = 'chat-demo:session-activity'
const HIDDEN_KEY = 'chat-demo:casual-hidden'
/** 主页「常用会话」不需要太多历史，超过就丢弃最久未用的 */
const MAX_ACTIVITY = 30

const readList = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key)
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

const writeList = (key: string, value: string[]) => {
  try {
    if (value.length === 0) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    // 隐私模式下写入失败时仍保留内存里的值
  }
}

export const useCasualSessions = create<{ activity: string[]; hidden: string[] }>(() => ({
  activity: readList(ACTIVITY_KEY),
  hidden: readList(HIDDEN_KEY),
}))

const setActivity = (activity: string[]) => {
  writeList(ACTIVITY_KEY, activity)
  useCasualSessions.setState({ activity })
}

const setHidden = (hidden: string[]) => {
  writeList(HIDDEN_KEY, hidden)
  useCasualSessions.setState({ hidden })
}

/** 发消息/重新生成/续写时调用：进入「常用」，并从隐藏名单里恢复 */
export const markSessionActive = (sessionId: string) => {
  const { activity, hidden } = useCasualSessions.getState()
  setActivity([sessionId, ...activity.filter((id) => id !== sessionId)].slice(0, MAX_ACTIVITY))
  if (hidden.includes(sessionId)) {
    setHidden(hidden.filter((id) => id !== sessionId))
  }
}

/** 只从聊天主页移除，不删除任何消息与附件 */
export const hideFromCasualHome = (sessionId: string) => {
  const { hidden } = useCasualSessions.getState()
  if (!hidden.includes(sessionId)) {
    setHidden([sessionId, ...hidden])
  }
}

/**
 * 把会话加入聊天主页（常用会话）。
 * 同时用于：隐藏过的会话恢复、导入后没聊过的会话手动上首页。
 */
export const addToCasualHome = (sessionId: string) => {
  markSessionActive(sessionId)
}

/** 会话当前是否显示在聊天主页（在常用名单里且没有被移除） */
export const isOnCasualHome = (sessionId: string) => {
  const { activity, hidden } = useCasualSessions.getState()
  return activity.includes(sessionId) && !hidden.includes(sessionId)
}

export const restoreToCasualHome = (sessionId: string) => {
  const { hidden } = useCasualSessions.getState()
  if (hidden.includes(sessionId)) {
    setHidden(hidden.filter((id) => id !== sessionId))
  }
}

/** 删除会话时清掉对应记录 */
export const forgetCasualSessions = (ids: string[]) => {
  const removed = new Set(ids)
  const { activity, hidden } = useCasualSessions.getState()
  const nextActivity = activity.filter((id) => !removed.has(id))
  const nextHidden = hidden.filter((id) => !removed.has(id))
  if (nextActivity.length !== activity.length) {
    setActivity(nextActivity)
  }
  if (nextHidden.length !== hidden.length) {
    setHidden(nextHidden)
  }
}
