import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { closeImageViewer, useImageViewer } from './imageViewerState.js'
import styles from './ImageViewer.module.css'

/**
 * 应用内图片预览：全屏遮罩 + 居中大图。
 * Esc、点遮罩、右上角 × 都能关闭；打开时焦点移到关闭按钮，关闭后还给原元素。
 */
export const ImageViewer = () => {
  const t = useTranslate()
  const url = useImageViewer((state) => state.url)
  const name = useImageViewer((state) => state.name)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!url) {
      return
    }
    restoreRef.current = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeImageViewer()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const previous = restoreRef.current
      restoreRef.current = null
      if (previous instanceof HTMLElement) {
        previous.focus()
      }
    }
  }, [url])

  if (!url) {
    return null
  }
  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeImageViewer()
        }
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('imagePreview')}>
        <img className={styles.image} src={url} alt={name} draggable={false} />
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          aria-label={t('close')}
          onClick={closeImageViewer}
        >
          <IconCloseOutline16 />
        </button>
      </div>
    </div>,
    document.body
  )
}
