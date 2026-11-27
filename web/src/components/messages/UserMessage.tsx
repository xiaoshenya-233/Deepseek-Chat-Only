import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  IconCameraOutline16,
  IconCloseFill14,
  IconEditOutline16,
  IconImageOutline16,
  IconPaperclipOutline16,
  IconRefreshOutline16,
} from '../base/icons.js'
import {
  ACCEPT,
  cancelUpload,
  getFileViewType,
  isImage,
  resolveMimeType,
  uploadAttachment,
  useUploads,
  validateFiles,
} from '../../services/attachments.js'
import { editMessage, retryUpload } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { compressImageForStorage } from '../../utils/compressImage.js'
import { createId } from '../../utils/id.js'
import { showToast } from '../base/toastState.js'
import { FileCard } from '../files/FileCard.js'
import { useFileView } from '../files/useFileView.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { FileAttachment, UserMessage as UserMessageType } from '../../services/chat/types.js'
import type { UploadTask } from '../../services/attachments.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { MessageFile } from './MessageFile.js'
import { CopyButton } from './CopyButton.js'
import styles from './UserMessage.module.css'

type EditAttachment = FileAttachment & {
  /** 本次编辑新加的本地文件；旧附件没有这个字段 */
  file?: File
}

/** 编辑态附件：图片显示缩略图 + 删除/重试，文档复用消息里的文件卡片 */
const EditFileChip = ({
  item,
  task,
  onRemove,
  onRetry,
}: {
  item: EditAttachment
  task?: UploadTask
  onRemove: () => void
  onRetry: () => void
}) => {
  const t = useTranslate()
  const { image, url } = useFileView(item.file ?? item.id, item.name)
  const uploading = task?.status === 'uploading'
  const failed = task?.status === 'error'
  const errorText = task?.status === 'error' ? t(task.error.key, task.error.params) : undefined
  const retryLabel = t('uploadRetry', { message: errorText ?? t('uploadFileStatusFailed') })
  if (image) {
    return (
      <div className={styles.editChip} title={errorText ?? item.name}>
        {url ? (
          <img className={styles.editThumb} src={url} alt={item.name} />
        ) : (
          <span className={styles.editThumb} />
        )}
        {uploading ? (
          <span className={styles.editOverlay}>
            <span className={styles.editSpinner} />
          </span>
        ) : null}
        {failed ? (
          <button
            type="button"
            className={styles.editRetry}
            aria-label={retryLabel}
            onClick={onRetry}
          >
            <IconRefreshOutline16 />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.editRemove}
          aria-label={t('delete')}
          onClick={onRemove}
        >
          <IconCloseFill14 />
        </button>
      </div>
    )
  }
  return (
    <FileCard
      name={item.name}
      size={item.size}
      status={uploading ? 'uploading' : failed ? 'error' : 'done'}
      error={errorText}
      onRetry={failed ? onRetry : undefined}
      onRemove={onRemove}
    />
  )
}

export const UserMessage = memo(function UserMessage({
  sessionId,
  message,
  retryUploadId,
  isFirst,
  isLast,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: UserMessageType
  /** 回答因补传附件失败可重试时为该回答 id */
  retryUploadId: string | null
  isFirst: boolean
  isLast: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  /** 编辑态附件面板：默认收起，点回形针按钮才展开三类 */
  const [attachMenu, setAttachMenu] = useState(false)
  const isMobile = useIsMobile()
  const tasks = useUploads((state) => state.tasks)
  /** 编辑态的附件列表：旧附件直接沿用，本次新加的是本地 File，需要先上传 */
  const [editFiles, setEditFiles] = useState<EditAttachment[]>([])
  const uploading = editFiles.some((file) => file.file && tasks[file.id]?.status === 'uploading')
  const uploadFailed = editFiles.some((file) => file.file && tasks[file.id]?.status === 'error')
  const canSend = !busy && !uploading && !uploadFailed && (draft.trim() !== '' || editFiles.length > 0)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (editing && textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 202)}px`
    }
  }, [editing, draft])

  // 展开附件面板时：点外部或按 Esc 收起（与输入框区域的行为一致）
  useEffect(() => {
    if (!attachMenu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-edit-attach-menu]')) {
        setAttachMenu(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttachMenu(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [attachMenu])

  /** 编辑时保留的旧附件 + 本次新加的本地文件；新文件上传完成后才允许发送 */
  const startEditing = () => {
    setDraft(message.content)
    setEditFiles(message.files.map((file) => ({ ...file })))
    setAttachMenu(false)
    setEditing(true)
  }

  const addEditFiles = async (picked: File[]) => {
    if (picked.length === 0) {
      return
    }
    const error = validateFiles(picked, editFiles.length)
    if (error) {
      showToast(error)
      return
    }
    const apiKey = useSettings.getState().apiKey ?? ''
    // 与输入框一致：图片先本地压缩（保清晰度）再上传并落库
    const added = await Promise.all(
      picked.map(async (file): Promise<EditAttachment> => {
        const id = createId()
        const imageFile = isImage(resolveMimeType(file))
        const stored = imageFile ? await compressImageForStorage(file).catch(() => file) : file
        void uploadAttachment(apiKey, id, stored, stored.name, imageFile).catch(() => {})
        return {
          id,
          serverId: null,
          name: stored.name,
          size: stored.size,
          isImage: imageFile,
          mimeType: resolveMimeType(stored),
          file: stored,
        }
      })
    )
    setEditFiles((current) => [...current, ...added])
  }

  const retryEditFile = (item: EditAttachment) => {
    if (!item.file) {
      return
    }
    const apiKey = useSettings.getState().apiKey ?? ''
    void uploadAttachment(apiKey, item.id, item.file, item.name, item.isImage).catch(() => {})
  }

  const removeEditFile = (id: string) => {
    cancelUpload(id)
    setEditFiles((current) => current.filter((item) => item.id !== id))
  }

  const sendEdit = () => {
    if (!canSend || !ensureApiKey()) {
      return
    }
    const files: FileAttachment[] = editFiles.map((item) => {
      const task = tasks[item.id]
      return {
        id: item.id,
        serverId: item.serverId ?? (task?.status === 'done' ? task.serverId : null),
        name: item.name,
        size: item.size,
        isImage: item.isImage,
        mimeType: item.mimeType,
      }
    })
    // 新加的附件原件跟会话一起落库，刷新后仍可查看与补传
    const blobs = editFiles.flatMap((item) => (item.file ? [{ id: item.id, blob: item.file }] : []))
    if (editMessage(sessionId, message.id, draft.trim(), files, blobs)) {
      stopReadAloud()
      setEditing(false)
    }
  }

  return (
    <div className={clsx(styles.container, isFirst && styles.isFirst)} data-message-id={message.id}>
      {message.files.length > 0 ? (
        <div
          className={clsx(
            styles.files,
            message.files.some((file) => !isImage(getFileViewType(file.name))) &&
              styles.filesWithDocuments
          )}
        >
          {message.files.map((file) => (
            <MessageFile
              key={file.id}
              file={file}
              onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
            />
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className={styles.editor}>
          {editFiles.length > 0 ? (
            <div className={styles.editFiles}>
              {editFiles.map((item) => (
                <EditFileChip
                  key={item.id}
                  item={item}
                  task={item.file ? tasks[item.id] : undefined}
                  onRemove={() => removeEditFile(item.id)}
                  onRetry={() => retryEditFile(item)}
                />
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            aria-label={t('editMessage')}
            autoFocus
            rows={1}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (event.key === 'Escape') {
                setEditing(false)
              } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !isMobile) {
                event.preventDefault()
                sendEdit()
              }
            }}
          />
          {attachMenu ? (
            <div
              className={styles.editAttachPanel}
              data-edit-attach-menu
              role="group"
              aria-label={t('attachmentAddLabel')}
            >
              <button
                type="button"
                className={styles.editAttachButton}
                disabled={busy}
                onClick={() => {
                  setAttachMenu(false)
                  cameraInputRef.current?.click()
                }}
              >
                <IconCameraOutline16 />
                <span>{t('attachmentAddCamera')}</span>
              </button>
              <button
                type="button"
                className={styles.editAttachButton}
                disabled={busy}
                onClick={() => {
                  setAttachMenu(false)
                  photoInputRef.current?.click()
                }}
              >
                <IconImageOutline16 />
                <span>{t('attachmentAddPhotos')}</span>
              </button>
              <button
                type="button"
                className={styles.editAttachButton}
                disabled={busy}
                onClick={() => {
                  setAttachMenu(false)
                  fileInputRef.current?.click()
                }}
              >
                <IconPaperclipOutline16 />
                <span>{t('attachmentAddFiles')}</span>
              </button>
            </div>
          ) : null}
          <div className={styles.editorActions}>
            {/* 与输入框一致：一个回形针按钮展开三类附件，不再平铺三个按钮 */}
            <IconButton
              className={styles.editorUpload}
              icon={<IconPaperclipOutline16 />}
              tooltip={t('attachmentAddLabel')}
              disabled={busy}
              aria-expanded={attachMenu}
              onClick={() => setAttachMenu((open) => !open)}
            />
            <input
              ref={cameraInputRef}
              type="file"
              capture="environment"
              accept="image/*"
              hidden
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                event.target.value = ''
                void addEditFiles(picked)
              }}
            />
            <input
              ref={photoInputRef}
              type="file"
              multiple
              accept="image/*"
              hidden
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                event.target.value = ''
                void addEditFiles(picked)
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                event.target.value = ''
                void addEditFiles(picked)
              }}
            />
            <Button size="s" variant="outlined" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button size="s" disabled={!canSend} onClick={sendEdit}>
              {t('send')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {message.content ? <div className={styles.bubble}>{message.content}</div> : null}
          <div className={styles.bottom}>
            <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
              {message.content ? <CopyButton text={message.content} /> : null}
              <IconButton
                icon={<IconEditOutline16 />}
                tooltip={t('editMessage')}
                tooltipPlacement="bottom"
                disabled={busy}
                onClick={startEditing}
              />
            </div>
            <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          </div>
        </>
      )}
    </div>
  )
})
