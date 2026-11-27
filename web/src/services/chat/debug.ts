import { useSettings } from '../settings.js'
import { addDraftFiles, getDraft, setDraftText } from './drafts.js'
import { planRequestImages } from './imageBudget.js'
import { getSessionPrompt } from './prompts.js'
import { toRequestMessages } from './reply.js'
import { activeRounds, buildTranscript, getSummary, mergeSummary, summaryTarget } from './summary.js'
import type { FileAttachment } from './types.js'
import { sendMessage, selectSession, useChatStore } from './store.js'

/**
 * 本机 QA 钩子：只在 `localStorage['chat-demo:debug'] === '1'` 时挂到 window 上，
 * 供自动化脚本核对请求拼装（提示词、草稿、发送结果），正常使用不生效。
 */
export const installDebugHooks = () => {
  if (localStorage.getItem('chat-demo:debug') !== '1') {
    return
  }
  ;(window as unknown as { __dsc?: unknown }).__dsc = {
    ready: () => useChatStore.getState().ready,
    activeId: () => useChatStore.getState().activeId,
    apiKeyLength: () => useSettings.getState().apiKey?.length ?? 0,
    sessionPrompt: (sessionId: string) => getSessionPrompt(sessionId),
    draft: (sessionId: string | null) => getDraft(sessionId),
    setDraft: (sessionId: string | null, text: string) => setDraftText(sessionId, text),
    send: (sessionId: string | null) => sendMessage(sessionId),
    open: (sessionId: string) => selectSession(sessionId),
    streaming: (sessionId: string) => Object.hasOwn(useChatStore.getState().streaming, sessionId),
    /** 走真实添加附件流程（图片去重），返回草稿里的附件 id；无 key 时上传会失败但不影响去重 */
    addFiles: (sessionId: string | null, files: File[]) =>
      addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? ''),
    /** 草稿附件的 id 列表，用于核对同一张图是否复用了同一个附件 id */
    draftAttachmentIds: (sessionId: string | null) =>
      getDraft(sessionId).attachments.map((attachment) => attachment.id),
    /** 图片挑选（只追加规则）：返回纳入请求的图片 id 列表 */
    planImages: (
      question: { id: string; size: number; isImage: boolean }[],
      history: { id: string; size: number; isImage: boolean }[][],
      budgetBytes: number,
      maxImages: number
    ) =>
      [
        ...planRequestImages(
          question as never,
          history as never,
          budgetBytes,
          maxImages,
          (file) => file.size
        ).keep,
      ],
    /** 当前分支的轮次与摘要 transcript（只含选中分支，用于核对分支隔离） */
    summarySource: (sessionId: string) => {
      const session = useChatStore.getState().sessionCache[sessionId]
      if (!session) {
        return null
      }
      const rounds = activeRounds(session)
      return {
        rounds: rounds.length,
        questions: rounds.map(([user]) => user.content.slice(0, 24)),
        transcript: buildTranscript(rounds, 0, rounds.length).slice(0, 400),
      }
    },
    /** 拼接决策：旧摘要是否原样保留、是否需要整理 */
    mergeSummary: (previous: string, segment: string) => {
      const merged = mergeSummary(previous, segment)
      return {
        length: merged.text.length,
        consolidate: merged.consolidate,
        text: merged.text.slice(0, 120),
      }
    },
    /** 当前会话是否该追加摘要，返回目标轮数（null 表示不需要） */
    summaryTarget: (sessionId: string) => {
      const session = useChatStore.getState().sessionCache[sessionId]
      return session ? summaryTarget(session) : null
    },
    /** 只组装请求（不发网络），返回每条消息的角色、块类型与文字片段 */
    requestShape: (sessionId: string, questionFiles: FileAttachment[] = []) => {
      const session = useChatStore.getState().sessionCache[sessionId]
      if (!session) {
        return null
      }
      const messages = toRequestMessages(
        session.messages,
        { id: 'preview', role: 'user', content: '预览提问', files: questionFiles, createdAt: 0 },
        undefined,
        false,
        '2026-01-01,周四,,Web,中文'
      )
      return messages.map((message) => {
        const content = message.content
        return {
          role: message.role,
          types: Array.isArray(content) ? content.map((block) => block.type) : ['text'],
          texts: Array.isArray(content)
            ? content.flatMap((block) => (block.type === 'text' ? [block.text.slice(0, 30)] : []))
            : [String(content).slice(0, 30)],
        }
      })
    },
    /** 只组装请求（不发网络），用于核对摘要/图片对 messages 的影响 */
    previewRequest: (sessionId: string) => {
      const session = useChatStore.getState().sessionCache[sessionId]
      if (!session) {
        return null
      }
      const summary = getSummary(sessionId)
      const messages = toRequestMessages(
        session.messages,
        { id: 'preview', role: 'user', content: '预览提问', files: [], createdAt: 0 },
        undefined,
        false,
        '2026-01-01,周四,,Web,中文',
        undefined,
        summary ?? undefined
      )
      return {
        summaryRounds: summary?.rounds ?? 0,
        count: messages.length,
        // 只取开头几条，避免日志过长
        roles: messages.slice(0, 6).map((message) => message.role),
        head: messages
          .slice(0, 2)
          .map((message) =>
            typeof message.content === 'string'
              ? message.content.slice(0, 40)
              : `${message.content.length} blocks`
          ),
      }
    },
  }
}
