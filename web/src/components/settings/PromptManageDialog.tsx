import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { exportPrompts, importPrompts } from '../../services/chat/promptBackup.js'
import {
  MAX_PROMPT_LENGTH,
  setSessionPrompt,
  useSessionPrompts,
} from '../../services/chat/prompts.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { IconDownloadOutline16, IconUploadOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './SessionManageDialog.module.css'

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 提示词管理：只管每个对话的自定义提示词——查看、编辑、清除，以及提示词 JSON 的导出/导入。
 * 与「对话管理」（导出所选对话 ZIP、批量删除对话）完全分开，避免两种导出混淆。
 */
export const PromptManageDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const prompts = useSessionPrompts((state) => state.prompts)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const keyword = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      keyword
        ? sessions.filter((session) =>
            (session.title || t('untitledChat')).toLowerCase().includes(keyword)
          )
        : sessions,
    [sessions, keyword, t]
  )
  const configured = sessions.filter((session) => prompts[session.id]).length

  const onExport = () => {
    const result = exportPrompts()
    if (!result) {
      setStatus(t('promptsBackupEmpty'))
      return
    }
    download(result.blob, result.name)
    setStatus(t('promptsBackupExported', { count: result.count }))
  }

  const onImport = async (file: File) => {
    setBusy(true)
    try {
      const { imported, skipped } = await importPrompts(file)
      setStatus(t('promptsBackupImported', { count: imported }))
      if (skipped > 0) {
        showToast({ key: 'promptsBackupSkipped', params: { count: skipped } })
      }
    } catch {
      setStatus(t('promptsBackupImportFailed'))
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (!editing) {
      return
    }
    setSessionPrompt(editing.id, editing.text)
    setEditing(null)
  }

  return (
    <Modal
      title={t('promptManageTitle')}
      closable
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={onClose}
      footer={
        <Button variant="outlined" size="m" onClick={onClose}>
          {t('sessionManageDone')}
        </Button>
      }
    >
      <p className={styles.hint}>{t('promptManageHint')}</p>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={query}
          placeholder={t('sessionManageSearch')}
          aria-label={t('sessionManageSearch')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button size="s" variant="outlined" onClick={onExport}>
          <IconDownloadOutline16 />
          {t('sessionManagePromptsExport')}
        </Button>
        <Button
          size="s"
          variant="outlined"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <IconUploadOutline14 />
          {t('sessionManagePromptsImport')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              void onImport(file)
            }
          }}
        />
      </div>
      <div className={styles.selection}>
        {t('promptsManagerSummary', { total: sessions.length, count: configured })}
      </div>
      {status ? <div className={styles.status}>{status}</div> : null}

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {sessions.length === 0 ? t('sessionManageEmpty') : t('promptsManagerNone')}
        </div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((session) => {
            const title = session.title || t('untitledChat')
            const prompt = prompts[session.id] ?? ''
            const isEditing = editing?.id === session.id
            return (
              <li key={session.id} className={styles.row}>
                <div className={styles.rowHead}>
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle} title={title}>
                      {title}
                    </div>
                    <div className={clsx(styles.excerpt, !prompt && styles.unset)} title={prompt}>
                      {prompt || t('promptsManagerUnset')}
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    {isEditing ? (
                      <>
                        <Button size="s" variant="outlined" onClick={() => setEditing(null)}>
                          {t('cancel')}
                        </Button>
                        <Button size="s" onClick={save}>
                          {t('save')}
                        </Button>
                      </>
                    ) : (
                      <>
                        {prompt ? (
                          <Button
                            size="s"
                            variant="outlined"
                            onClick={() => setSessionPrompt(session.id, '')}
                          >
                            {t('sessionPromptClear')}
                          </Button>
                        ) : null}
                        <Button
                          size="s"
                          variant="outlined"
                          onClick={() => setEditing({ id: session.id, text: prompt })}
                        >
                          {t('promptsManagerEdit')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <div className={styles.editor}>
                    <textarea
                      className={styles.textarea}
                      value={editing.text}
                      autoFocus
                      rows={6}
                      maxLength={MAX_PROMPT_LENGTH}
                      placeholder={t('sessionPromptPlaceholder')}
                      aria-label={t('promptManageTitle')}
                      onChange={(event) => setEditing({ id: session.id, text: event.target.value })}
                    />
                    <div className={styles.counter}>
                      {editing.text.length} / {MAX_PROMPT_LENGTH}
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

