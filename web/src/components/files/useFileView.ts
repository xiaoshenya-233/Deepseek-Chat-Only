import { useEffect, useState } from 'react'
import { getFileViewType, isImage } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'
import { showToast } from '../base/toastState.js'
import { closeImageViewer, useImageViewer } from './imageViewerState.js'
import {
  MAX_NATIVE_ATTACHMENT_BYTES,
  openAttachmentInSystemApp,
} from '../../utils/openAttachment.js'

const createViewUrl = (original: Blob, type: string) => {
  const blob = original.slice(0, original.size, type || 'application/octet-stream')
  if (type !== 'image/svg+xml') {
    return URL.createObjectURL(blob)
  }
  // SVG 缩略图用 data: 地址，单独打开图片时也与应用隔离。
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 草稿传 File，已发送的附件传 IndexedDB 原件 ID。 */
export const useFileView = (source: File | string, name: string) => {
  const type = getFileViewType(name)
  const [state, setState] = useState<{ source: File | string; type: string; url: string | null }>()
  useEffect(() => {
    let active = true
    const original = typeof source === 'string' ? loadFile(source) : Promise.resolve(source)
    const pending = original
      .then((blob) => (active && blob ? createViewUrl(blob, type) : null))
      .catch(() => null)
    void pending.then((url) => {
      if (active) {
        setState({ source, type, url })
      }
    })
    return () => {
      active = false
      void pending.then((url) => {
        if (url?.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
        // 正在预览这张图时消息被卸载：视图随之关闭，避免停留在失效的 blob 地址
        if (url && useImageViewer.getState().url === url) {
          closeImageViewer()
        }
      })
    }
  }, [source, type])

  const url = state?.source === source && state.type === type ? state.url : undefined
  const image = isImage(type)
  const isPdf = type === 'application/pdf'
  const openInTab = isPdf || (image && type !== 'image/svg+xml')
  const action = openInTab ? { target: '_blank', rel: 'noreferrer' } : { download: name }
  /**
   * PDF 等需要外部程序打开的文件：优先交给原生壳（Electron 写临时文件后 shell.openPath，
   * Android 走 Intent），纯浏览器或没有原生通道时退回新标签页。
   */
  const open = url
    ? async () => {
        try {
          if (await openAttachmentInSystemApp(name, url)) {
            return
          }
        } catch (error) {
          if (error instanceof Error && error.message === 'attachment-too-large') {
            showToast({
              key: 'attachmentTooLarge',
              params: { size: MAX_NATIVE_ATTACHMENT_BYTES / 1024 / 1024 },
            })
            return
          }
        }
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        if (!opened) {
          // 壳里 blob: 新标签页会被拦截，提示改用下载
          showToast({ key: 'attachmentOpenFailed' })
        }
      }
    : undefined
  return { url, image, isPdf, link: url ? { href: url, ...action } : undefined, open }
}
