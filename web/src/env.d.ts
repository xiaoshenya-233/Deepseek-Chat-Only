/** 原生壳（Electron / Android 的 JavascriptInterface）注入的桥；纯浏览器下为 undefined。 */
interface DeepseekNativeBridge {
  isDesktop?: boolean
  platform?: string
  beginDownload?: (ticket: string, name: string, mimeType: string, size: string) => unknown
  writeDownload?: (ticket: string, base64: string) => unknown
  endDownload?: (ticket: string) => unknown
  cancelDownload?: (ticket: string) => unknown
  /** 打开附件：Electron 返回 boolean，Android 为同步 void */
  openAttachment?: (name: string, mimeType: string, base64: string) => unknown
  showAttachmentError?: (message: string) => unknown
  getPaths?: () => Promise<{ userData: string; downloads: string }>
}

interface Window {
  DeepseekNative?: DeepseekNativeBridge
  /** 安卓壳的返回键回调：返回 true 表示页面已处理（关闭浮层或退回新对话页） */
  __dscHandleBack?: () => boolean
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 图片资源在构建时被替换为打包后的 URL */
declare module '*.png' {
  const url: string
  export default url
}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
