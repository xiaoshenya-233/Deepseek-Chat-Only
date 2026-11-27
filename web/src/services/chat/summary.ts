import { create } from 'zustand'
import type { CreateMessageRequest } from '../api/types.js'
import { streamMessage } from '../api/client.js'
import { translate } from '../../i18n/index.js'
import { getVisibleMessages } from './branches.js'
import { getContextRounds } from './reply.js'
import {
  SUMMARY_BATCH,
  SUMMARY_KEEP_RECENT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_ROUNDS,
} from './summaryLimits.js'
import type { AssistantMessage, Session, UserMessage } from './types.js'

/**
 * 上下文摘要：把较早的轮次提炼成结构化要点，之后请求只发送「摘要 + 最近若干轮原文」，
 * 不再逐轮重发全部历史，既省 token 也让前缀缓存更稳定。
 *
 * 记忆完整性的两条原则（对应 PROJECT_STATUS.md 5.1 / 5.2）：
 * 1. **只追加、不重写**：每次只把被挤出去的那几轮提炼成一段增量摘要，直接拼在旧摘要后面，
 *    不再让模型「把旧摘要重写一遍」——那会一轮轮丢细节；
 * 2. **只统计当前分支**：摘要始终基于 `getVisibleMessages(session)`（当前选中分支），
 *    未选中的历史版本绝不会进入摘要或影响轮数游标。
 *
 * 摘要存在 localStorage（和提示词一样属于本机配置，不写进官方格式的历史 ZIP）。
 */
export type SessionSummary = {
  /** 摘要正文：多段增量摘要用空行拼接，超过上限后会整理成一份 */
  text: string
  /** 已覆盖的上下文轮数（从当前分支最早的轮次开始算） */
  rounds: number
  updatedAt: number
}

/** 保留最近这些轮原文，不进入摘要 */
export {
  SUMMARY_BATCH,
  SUMMARY_KEEP_RECENT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_ROUNDS,
} from './summaryLimits.js'
/** 摘要请求里单条消息最多取多少字符，避免摘要请求本身过大 */
const TRANSCRIPT_ITEM_LIMIT = 1200
/** 单次增量摘要的字符上限 */
const TRANSCRIPT_LIMIT = 24000

const KEY = 'chat-demo:session-summaries'

type SummaryMap = Record<string, SessionSummary>

const read = (): SummaryMap => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const summaries: SummaryMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const entry = value as Partial<SessionSummary>
      if (typeof entry.text === 'string' && entry.text.trim() && Number.isFinite(entry.rounds)) {
        summaries[id] = {
          text: entry.text,
          rounds: Math.max(0, Math.floor(entry.rounds ?? 0)),
          updatedAt: Number(entry.updatedAt) || 0,
        }
      }
    }
    return summaries
  } catch {
    return {}
  }
}

export const useSummaries = create<{ summaries: SummaryMap }>(() => ({ summaries: read() }))

const write = (summaries: SummaryMap) => {
  try {
    if (Object.keys(summaries).length === 0) {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, JSON.stringify(summaries))
    }
  } catch {
    // 隐私模式下写入失败时仍保留内存里的值
  }
  useSummaries.setState({ summaries })
}

/** 供请求拼装使用（非 React 环境） */
export const getSummary = (sessionId: string): SessionSummary | null =>
  useSummaries.getState().summaries[sessionId] ?? null

/** 组件订阅某个会话的摘要 */
export const useSummary = (sessionId: string): SessionSummary | null =>
  useSummaries((state) => state.summaries[sessionId] ?? null)

export const setSummary = (sessionId: string, summary: SessionSummary) =>
  write({ ...useSummaries.getState().summaries, [sessionId]: summary })

export const removeSessionSummary = (sessionId: string) => {
  const current = useSummaries.getState().summaries
  if (!Object.hasOwn(current, sessionId)) {
    return
  }
  write(
    Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)) as SummaryMap
  )
}

export const clearAllSummaries = () => write({})

const truncate = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text

type Round = [UserMessage, AssistantMessage]

/**
 * 当前分支的可用轮次：摘要、轮数游标、手动压缩全部基于这份路径，
 * 未选中的兄弟版本不会出现在这里（PROJECT_STATUS.md 4.4）。
 */
export const activeRounds = (session: Session): Round[] =>
  getContextRounds(getVisibleMessages(session))

/** 把轮次区间 [from, to) 拼成摘要请求用的纯文本 */
export const buildTranscript = (rounds: Round[], from: number, to: number): string => {
  const lines: string[] = []
  for (const [index, [user, reply]] of rounds.entries()) {
    if (index < from || index >= to) {
      continue
    }
    const question = truncate(user.content.trim() || '(仅附件)', TRANSCRIPT_ITEM_LIMIT)
    const answer = truncate(
      reply.blocks
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim(),
      TRANSCRIPT_ITEM_LIMIT
    )
    lines.push(`【第 ${index + 1} 轮】\n用户：${question}\n助手：${answer || '(无正文)'}`)
  }
  return truncate(lines.join('\n\n'), TRANSCRIPT_LIMIT)
}

const SUMMARY_BASE: Omit<CreateMessageRequest, 'system' | 'messages'> = {
  model: 'deepseek-flash',
  thinking: { type: 'disabled' },
  tools: [],
  safety_check: { level: 'high' },
}

/** 增量摘要请求：只提炼本次被挤出去的那几轮，输出四段结构化要点 */
export const buildSummaryRequest = (
  transcript: string,
  from: number,
  to: number
): CreateMessageRequest => ({
  ...SUMMARY_BASE,
  system: translate('summarySystem'),
  messages: [
    {
      role: 'user',
      content: translate('summaryUser', {
        from: String(from + 1),
        to: String(to),
        transcript,
      }),
    },
  ],
})

/** 整理请求：分段摘要超过上限时合并成一份，要求原样保留细节 */
export const buildConsolidateRequest = (text: string): CreateMessageRequest => ({
  ...SUMMARY_BASE,
  system: translate('summaryConsolidateSystem', { limit: String(SUMMARY_MAX_CHARS) }),
  messages: [{ role: 'user', content: translate('summaryConsolidateUser', { text }) }],
})

/** 同一会话同时只跑一次摘要，避免并发改写 */
const running = new Set<string>()

/**
 * 有效覆盖轮数：游标不能吃掉「保留原文」的最近若干轮。
 * 旧版本按全部分支计轮，可能写进超出当前分支的游标；这里统一夹紧并自愈。
 */
export const fitCovered = (rounds: number, summary: SessionSummary | null): number =>
  Math.min(summary?.rounds ?? 0, Math.max(0, rounds - SUMMARY_KEEP_RECENT))

/** 游标超出当前分支时（历史数据或分支切换）原地修正，返回修正后的摘要 */
const healCursor = (session: Session, rounds: number): SessionSummary | null => {
  const current = getSummary(session.id)
  const max = Math.max(0, rounds - SUMMARY_KEEP_RECENT)
  if (!current || current.rounds <= max) {
    return current
  }
  const healed = { ...current, rounds: max, updatedAt: Date.now() }
  setSummary(session.id, healed)
  return healed
}

/**
 * 判断是否需要更新摘要：第一次需要攒够 `SUMMARY_MIN_ROUNDS` 轮，
 * 之后每新增 `SUMMARY_BATCH` 轮（且仍有可压缩的轮次）追加一次。
 * 轮数一律按当前选中分支统计。
 */
export const summaryTarget = (session: Session): number | null => {
  const rounds = activeRounds(session).length
  healCursor(session, rounds)
  const covered = fitCovered(rounds, getSummary(session.id))
  // 保留最近 SUMMARY_KEEP_RECENT 轮原文不摘要
  const target = rounds - SUMMARY_KEEP_RECENT
  if (target <= covered) {
    return null
  }
  if (covered === 0) {
    return rounds >= SUMMARY_MIN_ROUNDS ? target : null
  }
  return target - covered >= SUMMARY_BATCH ? target : null
}

/**
 * 自动追加摘要（失败静默）。
 * @param session 当前会话（摘要只读取当前分支已完成的轮次）
 */
export const summarizeSession = async (
  session: Session,
  apiKey: string,
  signal?: AbortSignal
): Promise<void> => {
  if (!apiKey || running.has(session.id)) {
    return
  }
  const target = summaryTarget(session)
  if (target === null) {
    return
  }
  await runSummary(session, apiKey, target, signal)
}

/** 手动压缩的结果：成功时给出压缩后的轮数，失败时给出原因 */
export type CompressResult =
  | { ok: true; rounds: number }
  | { ok: false; reason: 'no-key' | 'busy' | 'empty' | 'failed' }

/**
 * 立即压缩上下文：不受自动阈值限制，把「最近 `SUMMARY_KEEP_RECENT` 轮以前」的全部对话
 * 追加进摘要，用于长会话临时省 token。已经覆盖到的轮次不会重复压缩。
 */
export const compressContextNow = async (
  session: Session,
  apiKey: string
): Promise<CompressResult> => {
  if (!apiKey) {
    return { ok: false, reason: 'no-key' }
  }
  if (running.has(session.id)) {
    return { ok: false, reason: 'busy' }
  }
  const rounds = activeRounds(session).length
  healCursor(session, rounds)
  const target = rounds - SUMMARY_KEEP_RECENT
  if (target <= fitCovered(rounds, getSummary(session.id))) {
    return { ok: false, reason: 'empty' }
  }
  const ok = await runSummary(session, apiKey, target)
  return ok ? { ok: true, rounds: target } : { ok: false, reason: 'failed' }
}

/** 摘要请求的文本流收集：成功返回正文，失败或空返回空串 */
const requestSummaryText = async (
  apiKey: string,
  request: CreateMessageRequest,
  signal: AbortSignal
): Promise<string> => {
  let text = ''
  try {
    for await (const event of streamMessage(apiKey, request, signal)) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        text += event.content_block.text
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
  } catch {
    // 摘要失败不影响正常对话
  }
  return text.trim()
}

/** 拼接决策：旧摘要原样保留，新要点追加；只有超过上限才需要整理成一份 */
export const mergeSummary = (
  previous: string,
  segment: string
): { text: string; consolidate: boolean } => {
  const text = previous ? `${previous}\n\n${segment}` : segment
  return { text, consolidate: text.length > SUMMARY_MAX_CHARS }
}

/**
 * 增量追加摘要：只把本次被挤出去的 `[covered, target)` 轮提炼成一段新要点，
 * 直接拼在旧摘要后面（不重写旧内容）；拼接结果超过 `SUMMARY_MAX_CHARS` 时才整理一次。
 */
const runSummary = async (
  session: Session,
  apiKey: string,
  target: number,
  signal?: AbortSignal
): Promise<boolean> => {
  const current = getSummary(session.id)
  const covered = fitCovered(activeRounds(session).length, current)
  const rounds = activeRounds(session)
  const transcript = buildTranscript(rounds, covered, target)
  if (!transcript) {
    return false
  }
  running.add(session.id)
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const segment = await requestSummaryText(
      apiKey,
      buildSummaryRequest(transcript, covered, target),
      controller.signal
    )
    // 生成失败或为空时保持旧摘要与游标不动
    if (!segment) {
      return false
    }
    const merged = mergeSummary(current?.text ?? '', segment)
    let text = merged.text
    if (merged.consolidate) {
      const consolidated = await requestSummaryText(
        apiKey,
        buildConsolidateRequest(text),
        controller.signal
      )
      // 整理失败时保留拼接结果，宁可变长也不丢信息
      if (consolidated) {
        text = consolidated
      }
    }
    setSummary(session.id, { text, rounds: target, updatedAt: Date.now() })
    return true
  } finally {
    signal?.removeEventListener('abort', abort)
    running.delete(session.id)
  }
}
