import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  MAX_PROMPT_LENGTH,
  setSessionPrompt,
  useSessionPrompt,
} from '../../services/chat/prompts.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './SessionPromptDialog.module.css'

/**
 * 当前对话的自定义提示词：保存后追加到系统提示词之后，只影响这个对话。
 * 用于角色扮演设定或注入私有知识库。
 */
export const SessionPromptDialog = ({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string
  open: boolean
  onClose: () => void
}) => {
  const t = useTranslate()
  const saved = useSessionPrompt(sessionId)
  const [text, setText] = useState(saved)

  // 每次打开都以已保存的内容为准，避免上次未保存的编辑残留
  useEffect(() => {
    if (open) {
      setText(saved)
    }
  }, [open, saved])

  if (!open) {
    return null
  }
  return (
    <Modal
      title={t('sessionPromptTitle')}
      className={styles.dialog}
      closable
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              setSessionPrompt(sessionId, '')
              onClose()
            }}
          >
            {t('sessionPromptClear')}
          </Button>
          <Button
            size="m"
            onClick={() => {
              setSessionPrompt(sessionId, text)
              // 明确告知生效时机，避免以为没注入
              showToast({ key: text.trim() ? 'sessionPromptSaved' : 'sessionPromptCleared' })
              onClose()
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.description}>{t('sessionPromptDescription')}</div>
      <textarea
        className={styles.textarea}
        value={text}
        rows={9}
        maxLength={MAX_PROMPT_LENGTH}
        autoFocus
        placeholder={t('sessionPromptPlaceholder')}
        aria-label={t('sessionPromptTitle')}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.counter}>
        {text.length} / {MAX_PROMPT_LENGTH}
      </div>
    </Modal>
  )
}
