import { setSessionPrompt, useSessionPrompts } from './prompts.js'
import { useChatStore } from './store.js'

/**
 * 对话提示词的独立备份（JSON）。
 * 刻意不写进历史对话的 ZIP / manifest：那是 DeepSeek 官方导出格式，
 * 加自定义字段会让其他同类软件解析失败。
 */
const FORMAT_VERSION = 1

type PromptEntry = {
  /** 导出时的会话标题，便于人看 */
  title: string | null
  prompt: string
}

type PromptBackup = {
  version: number
  exportedAt: string
  prompts: Record<string, PromptEntry>
}

/** 导出全部提示词；没有设置过时返回 null */
export const exportPrompts = (): { name: string; blob: Blob; count: number } | null => {
  const prompts = useSessionPrompts.getState().prompts
  const entries = Object.entries(prompts)
  if (entries.length === 0) {
    return null
  }
  const titles = new Map(useChatStore.getState().sessions.map((item) => [item.id, item.title]))
  const payload: PromptBackup = {
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    prompts: Object.fromEntries(
      entries.map(([id, prompt]) => [id, { title: titles.get(id) ?? null, prompt }])
    ),
  }
  const stamp = payload.exportedAt.slice(0, 10)
  return {
    name: `deepseek-chat-prompts-${stamp}.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    count: entries.length,
  }
}

const readPrompt = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const prompt = (value as Record<string, unknown>).prompt
    return typeof prompt === 'string' ? prompt : null
  }
  return null
}

/** 导入提示词文件：按会话 id 覆盖同名对话的提示词 */
export const importPrompts = async (file: File): Promise<{ imported: number; skipped: number }> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('invalid-json')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid-format')
  }
  const payload = parsed as Record<string, unknown>
  if (payload.version !== FORMAT_VERSION) {
    throw new Error('unsupported-version')
  }
  const prompts = payload.prompts
  if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts)) {
    throw new Error('invalid-format')
  }
  let imported = 0
  let skipped = 0
  for (const [id, value] of Object.entries(prompts as Record<string, unknown>)) {
    const prompt = readPrompt(value)
    if (!id || prompt === null || !prompt.trim()) {
      skipped += 1
      continue
    }
    setSessionPrompt(id, prompt)
    imported += 1
  }
  return { imported, skipped }
}
