import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { addSticker, removeSticker, useStickers } from '../../services/chat/assets.js'
import { showToast } from '../base/toastState.js'
import styles from './StickerPicker.module.css'

/** 悬停多久后放大预览（太短会在快速划过时闪烁） */
const PREVIEW_DELAY = 140
const PREVIEW_SIZE = 168

type Preview = { url: string; left: number; top: number }

/**
 * 表情包面板：上传的图片自动压缩后存入 IndexedDB；
 * 点某个表情会以图片附件的形式进入输入框（走同一条上传/发送链路）。
 * 悬停时在指针附近弹出放大的预览气泡（portal + fixed，不参与布局，避免抖动）。
 */
export const StickerPicker = ({ onPick }: { onPick: (file: File) => void }) => {
  const t = useTranslate()
  const items = useStickers((state) => state.items)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPreview = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current)
      previewTimer.current = null
    }
    setPreview(null)
  }, [])

  useEffect(() => cancelPreview, [cancelPreview])

  // 只在窗口尺寸变化时收起预览；消息列表自己的滚动不应影响表情面板
  useEffect(() => {
    if (!preview) {
      return
    }
    window.addEventListener('resize', cancelPreview)
    return () => window.removeEventListener('resize', cancelPreview)
  }, [preview, cancelPreview])

  const schedulePreview = (url: string, element: HTMLElement) => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current)
    }
    previewTimer.current = setTimeout(() => {
      const rect = element.getBoundingClientRect()
      // 优先放在光标单元格左侧（不遮住面板），空间不够时放右侧
      let left = rect.left - PREVIEW_SIZE - 10
      if (left < 8) {
        left = Math.min(rect.right + 10, window.innerWidth - PREVIEW_SIZE - 8)
      }
      const top = Math.min(
        Math.max(8, rect.top + rect.height / 2 - PREVIEW_SIZE / 2),
        window.innerHeight - PREVIEW_SIZE - 8
      )
      setPreview({ url, left, top })
    }, PREVIEW_DELAY)
  }

  const pick = (blob: Blob) => {
    const type = blob.type || 'image/png'
    onPick(new File([blob], `sticker-${Date.now()}.${type.split('/')[1] ?? 'png'}`, { type }))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>{t('stickerTitle')}</span>
        <button
          type="button"
          className={styles.add}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? '…' : t('stickerAdd')}
        </button>
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>{t('stickerEmpty')}</div>
      ) : (
        <div className={styles.grid} onScroll={cancelPreview}>
          {items.map((item) => (
            <div key={item.id} className={styles.cell}>
              <button
                type="button"
                className={styles.sticker}
                onMouseEnter={(event) => schedulePreview(item.url, event.currentTarget)}
                onMouseLeave={cancelPreview}
                onFocus={cancelPreview}
                onClick={() => pick(item.blob)}
              >
                <img src={item.url} alt="" draggable={false} />
              </button>
              <button
                type="button"
                className={styles.remove}
                aria-label={t('stickerRemove')}
                onClick={() => void removeSticker(item.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length === 0) {
            return
          }
          // 表情包只接受图片：其他格式直接跳过并提示，不写进 IndexedDB
          const images = files.filter((file) => file.type.startsWith('image/'))
          if (images.length < files.length) {
            showToast({ key: 'stickerNotImage', type: 'error' })
          }
          if (images.length === 0) {
            return
          }
          setBusy(true)
          try {
            for (const file of images) {
              await addSticker(file)
            }
          } catch {
            showToast({ key: 'stickerSaveFailed', type: 'error' })
          } finally {
            setBusy(false)
          }
        }}
      />
      {preview
        ? createPortal(
            <div
              className={styles.preview}
              style={{ left: preview.left, top: preview.top, width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
              aria-hidden="true"
            >
              <img src={preview.url} alt="" draggable={false} />
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
