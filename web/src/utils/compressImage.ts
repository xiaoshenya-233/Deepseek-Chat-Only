/**
 * 落库前的图片压缩：用户选图与导入归档共用。
 *
 * 与上传副本（`resizeUploadImage`，2048px / 1.5 MiB）区分：这里的预算更宽松，
 * 目的是减少 IndexedDB 与历史导出的体积，而不是满足服务端配额，所以优先保清晰度：
 * 长边 2560px、首档质量 0.92，只有确实变小才替换；上传时仍会再压一次。
 */
const KEEP_ORIGINAL_TYPES = new Set(['image/gif', 'image/svg+xml'])
const MAX_IMAGE_EDGE = 2560
const TARGET_BYTES = 1.2 * 1024 * 1024
/** 小于该体积的图片已经足够小，不必再解码重编码 */
const MIN_BYTES = 512 * 1024
const QUALITY_STEPS = [0.92, 0.86, 0.8]
const EDGE_STEPS = [1, 0.8, 0.64]

const decodeImage = async (blob: Blob) => {
  const image = new Image()
  const url = URL.createObjectURL(blob)
  try {
    image.src = url
    await image.decode()
    return { image, longestEdge: Math.max(image.naturalWidth, image.naturalHeight) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Cannot encode image'))),
      type,
      quality
    )
  })

/** 后缀跟随实际编码结果，避免 PNG 实际存成 WebP 后类型判断出错 */
const toCompressedFile = (file: File, blob: Blob) => {
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.slice('image/'.length)
  const name = file.name.replace(/\.[^.]*$/, '') + '.' + extension
  return new File([blob], name, { type: blob.type, lastModified: file.lastModified })
}

/**
 * 返回压缩后的文件；不需要压缩、无法解码（如 HEIC）或压缩后反而更大时返回原文件。
 */
export const compressImageForStorage = async (
  file: File,
  signal?: AbortSignal
): Promise<File> => {
  if (!file.type.startsWith('image/') || KEEP_ORIGINAL_TYPES.has(file.type)) {
    return file
  }
  if (file.size <= MIN_BYTES) {
    return file
  }
  signal?.throwIfAborted()
  const { image, longestEdge } = await decodeImage(file)
  signal?.throwIfAborted()
  if (longestEdge <= MAX_IMAGE_EDGE && file.size <= TARGET_BYTES) {
    return file
  }

  // JPEG 保留 JPEG；带透明通道的 PNG/WebP 等改用 WebP，避免透明区域变黑
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
  const canvas = document.createElement('canvas')
  try {
    let smallest: Blob | null = null
    for (const factor of EDGE_STEPS) {
      const edge = Math.max(1, Math.round(Math.min(MAX_IMAGE_EDGE, longestEdge) * factor))
      const scale = edge / longestEdge
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Cannot resize image')
      }
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITY_STEPS) {
        const blob = await encode(canvas, type, quality)
        signal?.throwIfAborted()
        if (!smallest || blob.size < smallest.size) {
          smallest = blob
        }
        if (blob.size <= TARGET_BYTES) {
          return blob.size < file.size ? toCompressedFile(file, blob) : file
        }
      }
      if (edge <= 640) {
        break
      }
    }
    // 压到最小边长仍超预算：取最小副本，但只有比原图更小才替换
    return smallest && smallest.size < file.size ? toCompressedFile(file, smallest) : file
  } finally {
    canvas.width = canvas.height = 0
  }
}
