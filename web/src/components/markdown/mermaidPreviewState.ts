import { create } from 'zustand'

type MermaidPreviewState = {
  /** 当前要放大的 SVG 文本，null 表示关闭 */
  markup: string | null
  /** 生成时使用的主题，用于保存时的底色 */
  dark: boolean
}

export const useMermaidPreview = create<MermaidPreviewState>(() => ({ markup: null, dark: false }))

export const openMermaidPreview = (markup: string, dark: boolean) =>
  useMermaidPreview.setState({ markup, dark })

export const closeMermaidPreview = () => useMermaidPreview.setState({ markup: null })
