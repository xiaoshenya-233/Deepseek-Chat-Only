import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { TranslationKey } from '../../i18n/index.js'
import { getVisibleMessages } from './branches.js'
import { loadSession } from './db.js'
import { useChatStore } from './store.js'
import type { Message, Session } from './types.js'

/** 预览只显示一行，超过这个长度直接截断，避免把长回复塞进列表 */
const MAX_PREVIEW = 60
/** 从最后一条往前找多少条：末条可能是空思考块、报错或未完成的回复 */
const LOOKBACK = 6

/** 聊天列表的预览：纯文本显示开头几句，图片/文件/markdown 只显示类型 */
export type SessionPreview = {
  kind: 'text' | 'image' | 'file' | 'mindmap' | 'chart' | 'code' | 'table'
  /** kind 为 text 时是截断后的正文；其余类型为空字符串，按 kind 显示标签 */
  text: string
}

/** 非文本预览的类型标签（图片、文件、脑图……） */
export const PREVIEW_LABELS: Record<Exclude<SessionPreview['kind'], 'text'>, TranslationKey> = {
  image: 'casualPreviewImage',
  file: 'casualPreviewFile',
  mindmap: 'casualPreviewMindmap',
  chart: 'casualPreviewChart',
  code: 'casualPreviewCode',
  table: 'casualPreviewTable',
}

const CODE_FENCE = /```([^\n`]*)\n?([\s\S]*?)```/

/** 去掉 markdown 记号，只留下可读的正文，避免列表里出现 ** 与 # */
const stripMarkdown = (input: string) =>
  input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^-{3,}\s*$/gm, ' ')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const clamp = (text: string) => {
  const normalized = text.trim()
  return normalized.length > MAX_PREVIEW ? `${normalized.slice(0, MAX_PREVIEW)}…` : normalized
}

/** 单段文本 → 预览：mermaid 脑图/图表、纯代码块、表格都只给类型 */
const previewFromText = (raw: string): SessionPreview | null => {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) {
    return null
  }
  const fence = CODE_FENCE.exec(text)
  if (fence) {
    const language = (fence[1] || '').trim().toLowerCase()
    const body = (fence[2] || '').trim()
    if (language === 'mermaid' || language === 'mindmap') {
      return { kind: /^\s*mindmap\b/i.test(body) ? 'mindmap' : 'chart', text: '' }
    }
    // 代码块前后还有正文时优先给正文，否则整条按代码显示
    const prose = stripMarkdown(text.replace(CODE_FENCE, ' '))
    return prose ? { kind: 'text', text: clamp(prose) } : { kind: 'code', text: '' }
  }
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length > 1) {
    const tableLines = lines.filter((line) => line.trim().startsWith('|')).length
    if (tableLines >= Math.ceil(lines.length * 0.6)) {
      return { kind: 'table', text: '' }
    }
  }
  const plain = clamp(stripMarkdown(text))
  return plain ? { kind: 'text', text: plain } : null
}

const previewFromMessage = (message: Message): SessionPreview | null => {
  if (message.role === 'user') {
    const text = previewFromText(message.content)
    if (text) {
      return text
    }
    if (message.files.length === 0) {
      return null
    }
    return { kind: message.files.some((file) => file.isImage) ? 'image' : 'file', text: '' }
  }
  for (let index = message.blocks.length - 1; index >= 0; index -= 1) {
    const block = message.blocks[index]
    if (block.type !== 'text' || block.isTemplate) {
      continue
    }
    const preview = previewFromText(block.text)
    if (preview) {
      return preview
    }
  }
  return null
}

/** 会话预览取自当前分支的最后一条有效消息 */
export const buildSessionPreview = (session: Session): SessionPreview | null => {
  const messages = getVisibleMessages(session)
  for (let index = messages.length - 1; index >= 0 && index >= messages.length - LOOKBACK; index -= 1) {
    const preview = previewFromMessage(messages[index])
    if (preview) {
      return preview
    }
  }
  return null
}

/** 右侧预览面板要展示的最新一条消息（正文不截断，图片等只有类型） */
export type LatestMessageView = {
  role: 'user' | 'assistant'
  /** 正文；只有附件时为 empty string */
  text: string
  preview: SessionPreview | null
  createdAt: number
}

/**
 * 取最新一条有内容的消息：末条可能还在生成（空回复）或只有思考块，
 * 这时展示用户自己的问题，和列表里的预览口径一致。
 */
export const buildLatestMessageView = (session: Session): LatestMessageView | null => {
  const messages = getVisibleMessages(session)
  for (let index = messages.length - 1; index >= 0 && index >= messages.length - LOOKBACK; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') {
      const text = message.content.trim()
      const preview = previewFromMessage(message)
      if (!text && !preview) {
        continue
      }
      return { role: 'user', text, preview, createdAt: message.createdAt }
    }
    const parts: string[] = []
    for (const block of message.blocks) {
      if (block.type === 'text' && !block.isTemplate && block.text.trim()) {
        parts.push(block.text.trim())
      }
    }
    const text = parts.join('\n\n')
    const preview = previewFromMessage(message)
    if (!text && !preview) {
      continue
    }
    return { role: 'assistant', text, preview, createdAt: message.createdAt }
  }
  return null
}

type PreviewEntry = {
  /** 生成预览时会话的 updatedAt：会话有新消息后自动失效重算 */
  updatedAt: number
  preview: SessionPreview | null
}

const usePreviewStore = create<{ entries: Record<string, PreviewEntry> }>(() => ({ entries: {} }))

/** 同一 (会话, 版本) 只读一次数据库；期间有新消息会用新的版本再读一次 */
const inflight = new Set<string>()

export const ensureSessionPreview = (sessionId: string, updatedAt: number) => {
  const cached = usePreviewStore.getState().entries[sessionId]
  if (cached?.updatedAt === updatedAt) {
    return
  }
  const key = `${sessionId}:${updatedAt}`
  if (inflight.has(key)) {
    return
  }
  inflight.add(key)
  void (async () => {
    try {
      const stored = await loadSession(sessionId)
      const preview = stored ? buildSessionPreview(stored) : null
      const entries = usePreviewStore.getState().entries
      const existing = entries[sessionId]
      // 期间已经有更新的预览时丢弃这次的结果
      if (existing && existing.updatedAt >= updatedAt) {
        return
      }
      usePreviewStore.setState({ entries: { ...entries, [sessionId]: { updatedAt, preview } } })
    } catch {
      // 读取失败时保持空预览，不影响列表可用性
    } finally {
      inflight.delete(key)
    }
  })()
}

/** 行组件用：返回当前会话的最新消息预览，缺数据时后台补读一次 */
export const useSessionPreview = (sessionId: string, updatedAt: number) => {
  const entry = usePreviewStore((state) => state.entries[sessionId])
  // 已打开的会话直接用内存里的正文：停止生成后立刻显示新回复的开头，无需再读数据库。
  // 生成中跳过（每帧都在变），此时沿用落盘时的预览。
  const opened = useChatStore((state) =>
    state.streaming[sessionId] ? undefined : state.sessionCache[sessionId]
  )
  const live = useMemo(() => (opened ? buildSessionPreview(opened) : undefined), [opened])
  useEffect(() => {
    ensureSessionPreview(sessionId, updatedAt)
  }, [entry, sessionId, updatedAt])
  if (live !== undefined) {
    return live
  }
  return entry && entry.updatedAt === updatedAt ? entry.preview : null
}
