import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  closeAvatarCrop,
  useAvatarCrop,
  type AvatarCropRequest,
} from '../../services/chat/avatarEditor.js'
import { setSessionAvatar } from '../../services/chat/assets.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './AvatarCropDialog.module.css'

/** 输出边长：列表 38px、聊天气泡 34px，512 已足够清晰 */
const OUTPUT = 512
const MAX_ZOOM = 3

/** 视口内对齐：图片比视口小时居中，比视口大时不允许露出空白 */
const clampAxis = (value: number, size: number, view: number) =>
  size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, value))

/**
 * 会话头像的 1:1 裁剪：拖动平移、滑块缩放，确认后按 512×512 落库。
 * 同一个弹窗服务所有入口（列表头像、菜单、聊天里的 AI 头像）。
 */
export const AvatarCropDialog = () => {
  const request = useAvatarCrop((state) => state.request)
  if (!request) {
    return null
  }
  // 换一张图就重置缩放与位置
  return (
    <CropDialog
      key={`${request.sessionId}:${request.file.name}:${request.file.size}`}
      request={request}
    />
  )
}

const CropDialog = ({ request }: { request: AvatarCropRequest }) => {
  const t = useTranslate()
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [view, setView] = useState(0)
  const [saving, setSaving] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ id: number; startX: number; startY: number; x: number; y: number } | null>(
    null
  )
  const src = useMemo(() => URL.createObjectURL(request.file), [request.file])

  // 裁剪框是正方形且随窗口变化，需要实测边长来换算坐标
  useEffect(() => {
    const element = viewportRef.current
    if (!element) {
      return
    }
    setView(element.clientWidth)
    const observer = new ResizeObserver(() => setView(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => URL.revokeObjectURL(src), [src])

  const applyZoom = (next: number) => {
    if (!natural || !view) {
      setZoom(next)
      return
    }
    // 以裁剪框中心为锚点缩放，避免放大后画面跳到角落
    const centerX = (view / 2 - x) / scale
    const centerY = (view / 2 - y) / scale
    const nextScale = (view / Math.min(natural.width, natural.height)) * next
    setZoom(next)
    setOffset({ x: view / 2 - centerX * nextScale, y: view / 2 - centerY * nextScale })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!natural) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x,
      y,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    setOffset({
      x: drag.x + (event.clientX - drag.startX),
      y: drag.y + (event.clientY - drag.startY),
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id === event.pointerId) {
      dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const confirm = async () => {
    const image = imageRef.current
    if (!image || !natural || !view || saving) {
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const context = canvas.getContext('2d')
    if (!context) {
      showToast({ key: 'sessionAvatarSaveFailed', type: 'error' })
      return
    }
    const ratio = OUTPUT / view
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, x * ratio, y * ratio, displayWidth * ratio, displayHeight * ratio)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    canvas.width = canvas.height = 0
    if (!blob) {
      showToast({ key: 'sessionAvatarSaveFailed', type: 'error' })
      return
    }
    setSaving(true)
    try {
      await setSessionAvatar(request.sessionId, new File([blob], 'avatar.png', { type: 'image/png' }))
      closeAvatarCrop()
    } catch {
      showToast({ key: 'sessionAvatarSaveFailed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const baseScale = natural && view ? view / Math.min(natural.width, natural.height) : 1
  const scale = baseScale * zoom
  const displayWidth = natural ? natural.width * scale : 0
  const displayHeight = natural ? natural.height * scale : 0
  const x = clampAxis(offset.x, displayWidth, view)
  const y = clampAxis(offset.y, displayHeight, view)

  return (
    <Modal
      title={t('sessionAvatarCropTitle')}
      closable
      onClose={closeAvatarCrop}
      footer={
        <>
          <Button variant="outlined" disabled={saving} onClick={closeAvatarCrop}>
            {t('cancel')}
          </Button>
          <Button disabled={saving || !natural} onClick={() => void confirm()}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.wrap}>
        <div
          ref={viewportRef}
          className={styles.viewport}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imageRef}
            className={styles.image}
            src={src}
            alt=""
            draggable={false}
            style={{
              width: displayWidth,
              height: displayHeight,
              transform: `translate(${x}px, ${y}px)`,
            }}
            onLoad={(event) => {
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
              setZoom(1)
              setOffset({ x: 0, y: 0 })
            }}
          />
          <div className={styles.mask} aria-hidden="true" />
        </div>
        <div className={styles.controls}>
          <span className={styles.zoomLabel}>{t('sessionAvatarCropZoom')}</span>
          <input
            className={styles.slider}
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            aria-label={t('sessionAvatarCropZoom')}
            onChange={(event) => applyZoom(Number(event.target.value))}
          />
          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              setZoom(1)
              setOffset({ x: 0, y: 0 })
            }}
          >
            {t('sessionAvatarCropReset')}
          </button>
        </div>
        <div className={styles.hint}>{t('sessionAvatarCropHint')}</div>
      </div>
    </Modal>
  )
}

