import type {
  AssistantBlockParam,
  FileBlockParam,
  MessageParam,
  MessageStreamEvent,
  OutputBlockStart,
  TextBlockParam,
} from '../api/types.js'
import { translate } from '../../i18n/index.js'
import { MAX_UPLOAD_IMAGE_BYTES } from '../../utils/resizeUploadImage.js'
import { planRequestImages } from './imageBudget.js'
import { SUMMARY_KEEP_RECENT } from './summaryLimits.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  ReplyBlock,
  ReplyStatus,
  UserMessage,
} from './types.js'

/**
 * 文件按 Files API 的 file_id（附件的 serverId）引用：图片用 image 块，其余用 document 块。
 * 发送前 streamReply 会先补齐 serverId；仍为 null 的是本地没有原件的附件，不进入请求。
 *
 * `seenImages` 用于历史轮次的图片去重：同一张图在更早的轮次已经发过就不再发真实 image 块，
 * 只记一次 `repeated`，由调用方换成文本占位。当前提问不传这个集合，保证新发的图一定带图。
 */
const toFileBlocks = (
  files: FileAttachment[],
  keepImages?: ReadonlySet<string>,
  seenImages?: Set<string>
): { blocks: FileBlockParam[]; omitted: number; repeated: number } => {
  const blocks: FileBlockParam[] = []
  let omitted = 0
  let repeated = 0
  for (const { id, serverId, isImage } of files) {
    if (!serverId) {
      continue
    }
    if (isImage && keepImages && !keepImages.has(id)) {
      omitted += 1
      continue
    }
    if (isImage && seenImages) {
      if (seenImages.has(id)) {
        repeated += 1
        continue
      }
      seenImages.add(id)
    }
    blocks.push({
      type: isImage ? 'image' : 'document',
      source: { type: 'file', file_id: serverId },
    })
  }
  return { blocks, omitted, repeated }
}

const toReplyBlock = (block: OutputBlockStart, now: number): ReplyBlock | null => {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, citations: block.citations ?? [] }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
        startedAt: now,
      }
    case 'server_tool_use':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
      return block
    default:
      return null
  }
}

const updateBlock = (
  reply: AssistantMessage,
  index: number,
  update: (block: ReplyBlock) => ReplyBlock
): AssistantMessage => {
  const block = reply.blocks[index]
  if (!block) {
    return reply
  }
  const blocks = [...reply.blocks]
  blocks[index] = update(block)
  return { ...reply, blocks }
}

/**
 * 把一个流式事件合并进回复：只追加可识别的内容块，用本次请求的临时索引映射处理增量。
 * 跳过的块不占位；续写直接追加到已有内容之后，message_delta 更新结束原因与累计用量。
 */
export const applyEvent = (
  reply: AssistantMessage,
  event: MessageStreamEvent,
  now: number,
  blockIndexes: Map<number, number>
): AssistantMessage => {
  const next: AssistantMessage =
    reply.status === 'streaming' ? reply : { ...reply, status: 'streaming' }
  switch (event.type) {
    case 'message_start':
      return { ...next, usage: event.message.usage ?? next.usage }
    case 'content_block_start': {
      blockIndexes.delete(event.index)
      const block = toReplyBlock(event.content_block, now)
      if (!block) {
        // 客户端工具内容不保存；未完成的工具往返也不能作为续写前缀。
        return event.content_block.type === 'tool_use' ? { ...next, prefix: false } : next
      }
      blockIndexes.set(event.index, next.blocks.length)
      return { ...next, blocks: [...next.blocks, block] }
    }
    case 'content_block_delta': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      const { delta } = event
      return updateBlock(next, index, (block) => {
        if (block.type === 'text' && delta.type === 'text_delta') {
          return { ...block, text: block.text + delta.text }
        }
        if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          return { ...block, thinking: block.thinking + delta.thinking }
        }
        if (block.type === 'thinking' && delta.type === 'signature_delta') {
          return { ...block, signature: (block.signature ?? '') + delta.signature }
        }
        if (block.type === 'text' && delta.type === 'citations_delta') {
          return { ...block, citations: [...(block.citations ?? []), delta.citation] }
        }
        return block
      })
    }
    case 'content_block_stop': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      blockIndexes.delete(event.index)
      return updateBlock(next, index, (block) =>
        block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
          ? { ...block, endedAt: now }
          : block
      )
    }
    case 'message_delta':
      return {
        ...next,
        stopReason: event.delta.stop_reason,
        stopDetails: event.delta.stop_details,
        usage: event.usage ?? next.usage,
      }
    default:
      return next
  }
}

/**
 * 回复结束：未结束的思考块以当前时间收尾。
 * 安全拒绝（stop_reason: refusal）时已下发的思考与正文不能撤回，按协议要求由客户端丢弃，只保留工具块。
 */
export const settleReply = (
  reply: AssistantMessage,
  status: Extract<ReplyStatus, 'done' | 'stopped' | 'error'>,
  now: number,
  error?: AssistantMessage['error']
): AssistantMessage => ({
  ...reply,
  status,
  error,
  blocks: reply.blocks.flatMap((block): ReplyBlock[] => {
    if (reply.stopReason === 'refusal' && (block.type === 'thinking' || block.type === 'text')) {
      return []
    }
    return block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
      ? [{ ...block, endedAt: now }]
      : [block]
  }),
})

/** 回复里所有文本块拼起来，用于复制与判断是否有回答 */
const getReplyText = (reply: AssistantMessage) =>
  reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * 只有正常达到输出上限或被停止的回复可续写，报错回复不能续写。
 * 末条限制由调用方判断，拒绝和客户端工具调用不能续写。
 * 本轮含服务端工具调用或结果（含 READ_LINK 和孤立结果块）的回复不能续写。
 * 服务端模板提示不能作为续写前缀。
 */
export const canContinueReply = (reply: AssistantMessage): boolean => {
  if (
    !reply.prefix ||
    reply.stopReason === 'refusal' ||
    reply.stopReason === 'tool_use' ||
    reply.blocks.some(
      (block) =>
        block.type === 'server_tool_use' ||
        block.type === 'web_search_tool_result' ||
        block.type === 'web_fetch_tool_result' ||
        (block.type === 'text' && block.isTemplate)
    )
  ) {
    return false
  }
  return (
    reply.status === 'stopped' ||
    (reply.status === 'done' && reply.stopReason === 'max_tokens')
  )
}

/**
 * 已结束或停止且有回答文本的回复才放进上下文；被安全拒绝的轮次不回传。
 * 服务端模板提示不进入上下文。
 */
const isUsableReply = (message: Message): message is AssistantMessage =>
  message.role === 'assistant' &&
  (message.status === 'done' || message.status === 'stopped') &&
  message.stopReason !== 'refusal' &&
  !message.blocks.some((block) => block.type === 'text' && block.isTemplate) &&
  getReplyText(message) !== ''

/**
 * 有文件时用内容块数组：先文件后文本，文件按 Files API 的 file_id 引用。
 * 传入 `seenImages` 时表示这是历史轮次：重复出现的图片换成文本占位，避免每轮重发同一张图。
 */
const toUserParam = (
  { content, files }: UserMessage,
  keepImages?: ReadonlySet<string>,
  seenImages?: Set<string>
): MessageParam => {
  const { blocks, omitted, repeated } = toFileBlocks(files, keepImages, seenImages)
  const parts: (FileBlockParam | TextBlockParam)[] = [...blocks]
  if (content) {
    parts.push({ type: 'text', text: content })
  }
  if (repeated > 0) {
    // 同一张图前面已经发过，这里只留一句引用说明，既保留轮次语义又省掉重复的图片块。
    const label = translate('historyImageReference')
    parts.push({ type: 'text', text: repeated > 1 ? `${label} ×${repeated}` : label })
  }
  if (omitted > 0) {
    // 被省略的图片留一条占位说明，避免模型以为这一轮没有附图。
    parts.push({ type: 'text', text: translate('olderImagesOmitted', { count: omitted }) })
  }
  return parts.length === 0 ? { role: 'user', content } : { role: 'user', content: parts }
}

/**
 * assistant 的内容块按历史与续写场景转换：
 * - 历史思考及其签名不回传；开启思考时续写只保留本轮非空白思考及其签名；
 * - 文本块去掉 citations（服务端忽略）。相邻文本直接拼接，被思考或工具隔开的文本用空行连接；
 *   省略历史思考后仍保留其前后正文的空行；
 * - 工具调用和结果只保留 kind 为 read_link 的块，其他历史工具块不回传；
 * - 阅读链接结果原样回传，保留 signature：服务端解密后将页面拼回该轮提问末尾；
 */
const toAssistantParam = (
  { blocks }: AssistantMessage,
  prefix = false,
  thinking = false
): Extract<MessageParam, { role: 'assistant' }> => {
  const content: AssistantBlockParam[] = []
  // 成功阅读的网页靠签名恢复正文；缺少有效签名时，调用与结果都不回传。
  const unsignedReadLinks = new Set(
    blocks.flatMap((block) =>
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      block.content.type === 'web_fetch_result' &&
      !block.signature?.trim()
        ? [block.tool_use_id]
        : []
    )
  )
  /** 正在拼接的文本块；遇到任何非文本块（含不回传的思考块）就结束 */
  let text: TextBlockParam | null = null
  for (const block of blocks) {
    // 空思考不改变续写位置，也不应把两段正文隔开，导致后端额外插入空行。
    if (prefix && block.type === 'thinking' && !block.thinking.trim()) {
      continue
    }
    if (block.type === 'text') {
      if (text) {
        text.text += block.text
      } else {
        const previous = content.at(-1)
        text = {
          type: 'text',
          text: `${previous?.type === 'text' ? '\n\n' : ''}${block.text}`,
        }
        content.push(text)
      }
      continue
    }
    text = null
    if (prefix && thinking && block.type === 'thinking') {
      // 续写保留本轮思考，历史轮次的思考省略。
      const { type, thinking, signature } = block
      content.push({ type, thinking, signature: signature ?? '' })
    } else if (
      block.type === 'server_tool_use' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.id)
    ) {
      const { type, id, name, input, kind } = block
      content.push({ type, id, name, input, kind })
    } else if (
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      !unsignedReadLinks.has(block.tool_use_id)
    ) {
      content.push(block)
    }
  }
  return {
    role: 'assistant',
    content: content.filter((block) => block.type !== 'text' || block.text !== ''),
  }
}

/** 历史中会进入请求上下文的轮次：提问后紧跟可用回答的才保留 */
export const getContextRounds = (history: Message[]): [UserMessage, AssistantMessage][] => {
  const rounds: [UserMessage, AssistantMessage][] = []
  for (let i = 0; i + 1 < history.length; i++) {
    const [user, reply] = [history[i], history[i + 1]]
    if (user.role === 'user' && isUsableReply(reply)) {
      rounds.push([user, reply])
      i++
    }
  }
  return rounds
}

/**
 * 单次请求携带的图片总量上限。服务端限制为 200 MiB（含 file_id 引用的图片），
 * 这里留出余量，避免按本地大小估算的偏差直接把请求顶到上限。
 */
export const MAX_REQUEST_IMAGE_BYTES = 150 * 1024 * 1024
/** 命中服务端上限并自动降级后使用的预算：只保留最近少量图片。 */
export const RETRY_REQUEST_IMAGE_BYTES = 24 * 1024 * 1024
/**
 * 单次请求的图片张数上限：服务端返回「Too many images: max 600 images per request」。
 * 历史里重复出现的同一张图只发一次真实 image 块（其余为文本占位），所以这里按唯一附件数计。
 */
export const MAX_REQUEST_IMAGES = 600
/** 张数超限后的降级重试：只带最近这些张 */
export const RETRY_REQUEST_IMAGES = 200

/**
 * 从历史里挑出要进入请求的图片：当前提问优先，历史按时间正序填充预算（只追加、不重排），
 * 这样提示词缓存的前缀不会被图片集合的变化打断。更早的图片由调用方以占位文本说明。
 * `skipRounds` 是已被摘要覆盖、不再发送原文的轮次数，这些轮次的图片不计入。
 */
export const selectRequestImages = (
  history: Message[],
  question: UserMessage,
  budget: number,
  maxImages = MAX_REQUEST_IMAGES,
  skipRounds = 0
): Set<string> => {
  const rounds = getContextRounds(history)
    .slice(skipRounds)
    .map(([item]) => item.files)
  return planRequestImages(
    question.files,
    rounds,
    budget,
    maxImages,
    // 上传副本会被压到单图上限以内，按较小者估算，避免早期大图把预算吃光。
    (file) => Math.min(file.size, MAX_UPLOAD_IMAGE_BYTES)
  ).keep
}

/**
 * 把会话转成请求的 messages：只保留「提问 + 有回答的回复」成对的轮次，最后接上本轮提问。
 * 失败或没有回答的轮次不进上下文。续写时末尾再带上本轮 assistant。
 *
 * 传入 `summary` 时，前 `summary.rounds` 轮原文不再发送，改为发送一段摘要
 * （user 摘要 + assistant 确认，保持 user/assistant 交替）：
 * 既省下重复发送全部历史的 token，摘要在一段时间内不变，也更容易命中前缀缓存。
 */
export const toRequestMessages = (
  history: Message[],
  question: UserMessage,
  prefix?: AssistantMessage,
  thinking = prefix?.thinking ?? false,
  latestReminder?: string,
  keepImages?: ReadonlySet<string>,
  summary?: { text: string; rounds: number }
): MessageParam[] => {
  const messages: MessageParam[] = []
  let previousReminder: string | undefined
  const appendReminder = (reminder: string | undefined) => {
    // 仅在当前分支首次出现或内容变化时插入快照；缺少快照的消息保持原有内容。
    if (reminder && reminder !== previousReminder) {
      messages.push({ role: 'latest_reminder', content: reminder })
      previousReminder = reminder
    }
  }
  const rounds = getContextRounds(history)
  // 历史里已发送过的图片 id：同一张图只在第一次出现时发真实 image 块（当前提问不受影响）
  const seenImages = new Set<string>()
  // 游标再大也不能吃掉最近 SUMMARY_KEEP_RECENT 轮原文：旧数据或分支切换写回的轮数可能偏高
  const covered =
    summary && summary.rounds > 0
      ? Math.min(summary.rounds, Math.max(0, rounds.length - SUMMARY_KEEP_RECENT))
      : 0
  if (covered > 0 && summary) {
    messages.push(
      { role: 'user', content: translate('historySummaryUser', { summary: summary.text }) },
      {
        role: 'assistant',
        content: [{ type: 'text', text: translate('historySummaryAssistant') }],
      }
    )
  }
  for (const [index, [user, reply]] of rounds.entries()) {
    if (index < covered) {
      continue
    }
    // 历史提问里的图片只发第一次出现的那张，后面重复的换成文本占位；当前提问不受影响。
    const userParam = toUserParam(user, keepImages, seenImages)
    // 提问没有文字、附件都被省略或没有 serverId 时，这一轮没有任何内容，连同回答一起省略。
    const empty = Array.isArray(userParam.content)
      ? userParam.content.length === 0
      : userParam.content === ''
    if (empty) {
      continue
    }
    appendReminder(reply.latestReminder)
    messages.push(userParam, toAssistantParam(reply))
  }
  appendReminder(latestReminder)
  // 当前提问始终发送真实图片块：去重只针对历史轮次
  messages.push(toUserParam(question, keepImages))
  if (prefix?.prefix) {
    const assistant = toAssistantParam(prefix, true, thinking)
    // 没有非空白正文或有效思考时直接重发原问题，避免服务端拒绝空 Prefill。
    if (
      assistant.content.some(
        (block) =>
          (block.type === 'text' && block.text.trim()) ||
          (block.type === 'thinking' && block.thinking.trim())
      )
    ) {
      messages.push(assistant)
    }
  }
  return messages
}
