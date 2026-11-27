import { create } from 'zustand'

type ImageViewerState = {
  /** 当前预览的图片地址（blob: 或 data:），为 null 表示关闭 */
  url: string | null
  /** 用于 alt 与无障碍名称 */
  name: string
}

export const useImageViewer = create<ImageViewerState>(() => ({ url: null, name: '' }))

/** 在应用内预览图片：三端通用，不依赖浏览器新标签页（壳里 blob: 会被拦截）。 */
export const openImageViewer = (url: string, name: string) =>
  useImageViewer.setState({ url, name })

export const closeImageViewer = () => useImageViewer.setState({ url: null, name: '' })
