import clsx from 'clsx'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconButton } from '../base/IconButton.js'
import { IconListOutline16 } from '../base/icons.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { Session, UserMessage } from '../../services/chat/types.js'
import { requestJumpToMessage } from '../messages/messageJump.js'
import styles from './SessionOutline.module.css'

/** 单行预览：压平空白、去掉 Markdown 记号，过长截断 */
const preview = (message: UserMessage, limit = 46) => {
  const flat = message.content
    .replace(/\s+/g, ' ')
    .replace(/`{1,3}|\*\*|__|^[#>\-*\s]+/g, '')
    .trim()
  if (flat) {
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
  }
  return null
}

/**
 * 会话总览（效率模式）：按顺序列出当前分支的每一次提问，点任意一条跳到那条消息
 * （分页之外的消息会先被挂载）。
 *
 * - `header`：桌面端标题栏按钮，浮层向下展开；
 * - `float`：移动端悬浮球，固定在输入框上方靠右，浮层向上展开。
 */
export const SessionOutline = ({
  session,
  variant = 'header',
}: {
  session: Session
  variant?: 'header' | 'float'
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const floating = variant === 'float'
  const questions = getVisibleMessages(session).filter(
    (message): message is UserMessage => message.role === 'user'
  )
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLElement, HTMLDivElement>(
    open,
    {
      side: floating ? 'top' : 'bottom',
      align: 'end',
      offset: floating ? 10 : 6,
      maxHeight: floating ? 360 : 420,
      measureKey: questions.length,
    }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))
  const toggle = () => setOpen((value) => !value)

  return (
    <>
      {floating ? (
        <button
          ref={anchorRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className={clsx(styles.floatButton, open && styles.floatButtonActive)}
          aria-label={t('sessionOutline')}
          aria-expanded={open}
          onClick={toggle}
        >
          <IconListOutline16 />
        </button>
      ) : (
        <span ref={anchorRef as React.RefObject<HTMLSpanElement>} className={styles.anchor}>
          <IconButton
            icon={<IconListOutline16 />}
            aria-label={t('sessionOutline')}
            tooltip={t('sessionOutline')}
            tooltipPlacement="bottom"
            onClick={toggle}
          />
        </span>
      )}
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={clsx(styles.panel, !position && styles.measuring)}
              style={position ?? undefined}
              role="menu"
            >
              <div className={styles.head}>
                {t('sessionOutlineCount', { count: questions.length })}
              </div>
              <div className={styles.list}>
                {questions.length === 0 ? (
                  <div className={styles.empty}>{t('sessionOutlineEmpty')}</div>
                ) : (
                  questions.map((message, index) => (
                    <div
                      key={message.id}
                      role="menuitem"
                      className={styles.item}
                      onClick={() => {
                        setOpen(false)
                        requestJumpToMessage(message.id)
                      }}
                    >
                      <span className={styles.index}>{index + 1}</span>
                      <span className={styles.text}>
                        {preview(message) ?? t('sessionOutlineFiles')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
