import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { compressImageForStorage } from '../../utils/compressImage.js'
import { createId } from '../../utils/id.js'
import {
  adoptServerId,
  cancelUpload,
  isImage,
  resolveMimeType,
  uploadAttachment,
  validateFiles,
  type UploadTask,
} from '../attachments.js'
import { findReusableFile, hashBlob, registerFileContent } from './fileIndex.js'
import type { FileAttachment } from './types.js'

export type DraftAttachment = {
  /** 本地标识，也是 IndexedDB 原件与上传任务的 key */
  id: string
  file: File
  isImage: boolean
}

type Draft = { text: string; attachments: DraftAttachment[] }

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] }

/** 草稿只保存在本次页面的内存中，独立于会话详情缓存；null 是新对话的草稿。 */
export const useDrafts = create<{ drafts: Map<string | null, Draft> }>(() => ({
  drafts: new Map(),
}))

export const getDraft = (sessionId: string | null): Draft =>
  useDrafts.getState().drafts.get(sessionId) ?? EMPTY_DRAFT

const updateDraft = (sessionId: string | null, update: (draft: Draft) => Draft) =>
  useDrafts.setState((state) => {
    const draft = update(state.drafts.get(sessionId) ?? EMPTY_DRAFT)
    const drafts = new Map(state.drafts)
    if (draft.text || draft.attachments.length > 0) {
      drafts.set(sessionId, draft)
    } else {
      drafts.delete(sessionId)
    }
    return { drafts }
  })

export const setDraftText = (sessionId: string | null, text: string) =>
  updateDraft(sessionId, (draft) => ({ ...draft, text }))

const upload = (attachment: DraftAttachment, apiKey: string) => {
  // 上传任务负责记录错误，输入框的附件卡片展示失败及重试入口。
  void uploadAttachment(
    apiKey,
    attachment.id,
    attachment.file,
    attachment.file.name,
    attachment.isImage
  ).catch(() => {})
}

/**
 * 整批校验通过后才加入草稿并开始上传。
 * 图片先做本地压缩（保清晰度），这样落库原件、上传副本和历史导出都更小；
 * 无法解码的图片退回原文件，不阻断添加流程。
 *
 * 图片按内容 SHA-256 去重：库里已有同一份内容时直接复用旧的附件 id 与 file_id，
 * 既不重复落库也不重复上传（用户常把同一张照片反复发）。
 */
export const addDraftFiles = async (
  sessionId: string | null,
  files: File[],
  apiKey: string
): Promise<TranslationMessage | null> => {
  if (files.length === 0) {
    return null
  }
  const error = validateFiles(files, getDraft(sessionId).attachments.length)
  if (error) {
    return error
  }
  const prepared = await Promise.all(
    files.map(async (file) => {
      const image = isImage(resolveMimeType(file))
      const stored = image ? await compressImageForStorage(file).catch(() => file) : file
      return { file, image, stored }
    })
  )
  // 压缩可以并行，但「算哈希 → 查索引 → 登记」必须串行：
  // 同一批里重复的图片要靠上一步登记结果命中，否则会并发各建一份。
  const added: DraftAttachment[] = []
  for (const { image, stored } of prepared) {
    const id = createId()
    if (image) {
      const hash = await hashBlob(stored)
      const reused = hash ? await findReusableFile(hash) : null
      if (reused) {
        // 同一张图已经存在：复用附件 id；已上传过时连上传都省掉
        if (reused.serverId) {
          adoptServerId(reused.id, reused.serverId)
        }
        added.push({ id: reused.id, file: stored, isImage: true })
        continue
      }
      if (hash) {
        await registerFileContent({ id, hash, size: stored.size })
      }
    }
    added.push({ id, file: stored, isImage: image })
  }
  updateDraft(sessionId, (draft) => ({ ...draft, attachments: [...draft.attachments, ...added] }))
  added.forEach((attachment) => upload(attachment, apiKey))
  return null
}

export const retryDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  apiKey: string
) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (attachment) {
    upload(attachment, apiKey)
  }
}

/** 发送按钮和实际提交共用规则：有内容，且全部附件已上传成功。 */
export const prepareDraftMessage = (draft: Draft, tasks: Record<string, UploadTask>) => {
  const text = draft.text.trim()
  if (!text && draft.attachments.length === 0) {
    return null
  }
  const files: (FileAttachment & { serverId: string; blob: Blob })[] = []
  const seen = new Set<string>()
  for (const attachment of draft.attachments) {
    // 同一张图重复贴进同一轮时只保留一份（内容去重后附件 id 相同）
    if (seen.has(attachment.id)) {
      continue
    }
    const task = tasks[attachment.id]
    if (task?.status !== 'done' || !task.serverId) {
      return null
    }
    seen.add(attachment.id)
    files.push({
      id: attachment.id,
      serverId: task.serverId,
      name: attachment.file.name,
      size: attachment.file.size,
      isImage: attachment.isImage,
      mimeType: resolveMimeType(attachment.file),
      blob: attachment.file,
    })
  }
  return { text, files }
}

export const removeDraftAttachment = (sessionId: string | null, attachmentId: string) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return
  }
  cancelUpload(attachment.id)
  updateDraft(sessionId, (draft) => ({
    ...draft,
    attachments: draft.attachments.filter((item) => item.id !== attachmentId),
  }))
}

/** 发送成功后原件与 serverId 已交给会话，保留上传完成态。 */
export const clearSentDraft = (sessionId: string | null) => {
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

/** 删除会话或替换历史成功后，释放尚未发送的草稿及上传任务。 */
export const clearDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach((attachment) => cancelUpload(attachment.id))
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

export const clearAllDrafts = () => {
  for (const draft of useDrafts.getState().drafts.values()) {
    draft.attachments.forEach((attachment) => cancelUpload(attachment.id))
  }
  useDrafts.setState({ drafts: new Map() })
}
