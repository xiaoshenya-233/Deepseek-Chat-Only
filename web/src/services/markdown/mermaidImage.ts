/**
 * 把 Mermaid 生成的 SVG 转成 PNG，用于「保存图片」。
 * 统一走字符串序列化：Mermaid 的图带 viewBox，按它确定像素尺寸，再按倍率放大绘制。
 */

const parseSize = (svg: Element): { width: number; height: number } => {
  const viewBox = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  const width = Number(svg.getAttribute('width')) || (viewBox?.[2] ?? 800)
  const height = Number(svg.getAttribute('height')) || (viewBox?.[3] ?? 600)
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

/**
 * Mermaid 产出的根节点是 width="100%" + style="max-width:…"，
 * 放进自适应容器会塌成 0；预览与栅格化前先补上明确像素尺寸。
 */
export const normalizeSvgSize = (markup: string): { markup: string; width: number; height: number } => {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = parsed.documentElement
  const { width, height } = parseSize(svg)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.removeAttribute('style')
  return { markup: new XMLSerializer().serializeToString(svg), width, height }
}

export const svgToPng = async (
  markup: string,
  { scale = 2, background = '#ffffff' }: { scale?: number; background?: string } = {}
): Promise<Blob> => {
  const normalized = normalizeSvgSize(markup)
  if (!normalized.markup.includes('<svg')) {
    throw new Error('invalid-svg')
  }
  const { width, height } = normalized
  const url = URL.createObjectURL(
    new Blob([normalized.markup], { type: 'image/svg+xml;charset=utf-8' })
  )
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('canvas-unavailable')
    }
    // 透明背景在浅色查看器里会糊掉，按当前主题填底色
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode-failed'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 触发下载：壳里由 native/download-bridge 接管保存位置 */
export const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const mermaidFileName = (dark: boolean) =>
  `mermaid-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}${dark ? '-dark' : ''}.png`
