import { create } from 'zustand'

/**
 * 每个对话单独保存的自定义提示词（角色扮演 / 知识库注入）。
 * 存在 localStorage：内容属于用户配置，和 API Key、主题一样不需要随会话导入导出。
 */
const KEY = 'chat-demo:session-prompts'
/** 与输入框一致的上限，避免把系统提示词撑得过大 */
export const MAX_PROMPT_LENGTH = 8000

type PromptMap = Record<string, string>

const read = (): PromptMap => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const prompts: PromptMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) {
        prompts[id] = value.slice(0, MAX_PROMPT_LENGTH)
      }
    }
    return prompts
  } catch {
    return {}
  }
}

export const useSessionPrompts = create<{ prompts: PromptMap }>(() => ({ prompts: read() }))

const write = (prompts: PromptMap) => {
  try {
    if (Object.keys(prompts).length === 0) {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, JSON.stringify(prompts))
    }
  } catch {
    // 隐私模式下写入失败时仍保留内存里的值
  }
  useSessionPrompts.setState({ prompts })
}

/** 供请求拼装使用（非 React 环境） */
export const getSessionPrompt = (sessionId: string): string =>
  useSessionPrompts.getState().prompts[sessionId] ?? ''

/** 组件订阅某个会话的提示词 */
export const useSessionPrompt = (sessionId: string): string =>
  useSessionPrompts((state) => state.prompts[sessionId] ?? '')

export const setSessionPrompt = (sessionId: string, text: string) => {
  const value = text.slice(0, MAX_PROMPT_LENGTH)
  const current = useSessionPrompts.getState().prompts
  const prompts = Object.fromEntries(
    Object.entries(current).filter(([id]) => id !== sessionId)
  ) as PromptMap
  if (value.trim()) {
    prompts[sessionId] = value
  }
  write(prompts)
}

/** 删除会话时一并清掉它的提示词 */
export const removeSessionPrompts = (ids: string[]) => {
  const current = useSessionPrompts.getState().prompts
  const removed = new Set(ids)
  const entries = Object.entries(current).filter(([id]) => !removed.has(id))
  if (entries.length === Object.keys(current).length) {
    return
  }
  write(Object.fromEntries(entries) as PromptMap)
}
