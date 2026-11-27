import clsx from 'clsx'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import {
  downloadBlob,
  mermaidFileName,
  svgToPng,
} from '../../services/markdown/mermaidImage.js'
import { IconCloseOutline16, IconDownloadOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { closeMermaidPreview, useMermaidPreview } from './mermaidPreviewState.js'
import styles from './MermaidPreview.module.css'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
/** 滚轮每一档的缩放系数基数，deltaY 越小越细腻 */
const WHEEL_SENSITIVITY = 0.0016

type View = { zoom: number; x: number; y: number }
const HOME: View = { zoom: 1, x: 0, y: 0 }

/**
 * 脑图放大查看：全屏遮罩 + 可缩放画布，支持保存为 PNG。
 * 交互：左键拖动平移、滚轮以光标为锚点缩放；文字不可选中，避免拖动时出现选区。
 */
export const MermaidPreview = () => {
  const t = useTranslate()
  const markup = useMermaidPreview((state) => state.markup)
  const dark = useMermaidPreview((state) => state.dark)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [view, setView] = useState<View>(HOME)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (markup) {
      setView(HOME)
      setSaving(false)
      setDragging(false)
      dragRef.current = null
    }
  }, [markup])

  useEffect(() => {
    if (!markup) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMermaidPreview()
      } else if (event.key === '+' || event.key === '=') {
        setView((current) => ({ ...current, zoom: clamp(current.zoom + 0.25) }))
      } else if (event.key === '-') {
        setView((current) => ({ ...current, zoom: clamp(current.zoom - 0.25) }))
      } else if (event.key === '0') {
        setView(HOME)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [markup])

  // 滚轮缩放必须 preventDefault 阻止页面滚动，React 的 wheel 监听是被动的，这里手动绑定。
  useEffect(() => {
    const stage = stageRef.current
    if (!markup || !stage) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      setView((current) => {
        const zoom = clamp(current.zoom * Math.exp(-event.deltaY * WHEEL_SENSITIVITY))
        if (zoom === current.zoom) {
          return current
        }
        // 以光标为锚点：光标下的那一点在缩放前后位置不变
        const cursorX = event.clientX - rect.left - rect.width / 2
        const cursorY = event.clientY - rect.top - rect.height / 2
        const ratio = zoom / current.zoom
        return {
          zoom,
          x: cursorX - (cursorX - current.x) * ratio,
          y: cursorY - (cursorY - current.y) * ratio,
        }
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [markup])

  useEffect(() => {
    if (!dragging) {
      return
    }
    const onPointerUp = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [dragging])

  if (!markup) {
    return null
  }

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    }
    setDragging(true)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    setView((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }))
  }

  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      const blob = await svgToPng(markup, { background: dark ? '#1b1b1f' : '#ffffff' })
      downloadBlob(blob, mermaidFileName(dark))
    } catch {
      showToast({ key: 'mermaidSaveFailed' })
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <div className={styles.toolbar}>
        <button
          type="button"
          className={clsx(styles.button, styles.iconButton)}
          aria-label={t('mermaidZoomOut')}
          title={t('mermaidZoomOut')}
          onClick={() => setView((current) => ({ ...current, zoom: clamp(current.zoom - 0.25) }))}
        >
          −
        </button>
        <span className={styles.zoomLabel}>{Math.round(view.zoom * 100)}%</span>
        <button
          type="button"
          className={clsx(styles.button, styles.iconButton)}
          aria-label={t('mermaidZoomIn')}
          title={t('mermaidZoomIn')}
          onClick={() => setView((current) => ({ ...current, zoom: clamp(current.zoom + 0.25) }))}
        >
          +
        </button>
        <button type="button" className={styles.button} onClick={() => setView(HOME)}>
          {t('mermaidZoomReset')}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={saving}
          onClick={() => void save()}
        >
          <IconDownloadOutline16 />
          {t('mermaidSaveImage')}
        </button>
        <button
          type="button"
          className={clsx(styles.button, styles.iconButton)}
          aria-label={t('close')}
          title={t('close')}
          onClick={closeMermaidPreview}
        >
          <IconCloseOutline16 />
        </button>
      </div>
      <div
        ref={stageRef}
        className={clsx(styles.stage, dragging && styles.stageDragging)}
        role="dialog"
        aria-modal="true"
        aria-label={t('mermaidExpand')}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setView((current) => (current.zoom === 1 ? { ...HOME, zoom: 2 } : HOME))}
      >
        <div className={styles.canvas}>
          <div
            className={clsx(styles.inner, dragging && styles.innerDragging)}
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
              backgroundColor: dark ? '#1b1b1f' : '#ffffff',
            }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
