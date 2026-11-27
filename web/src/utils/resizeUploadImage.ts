// 上传副本的尺寸与体积上限：
// 服务端按「单次请求图片总量 200 MiB（含 file_id 图片）」计算配额，历史里的图片每轮都会重发，
// 所以每张图先压到 ≤ 2048px、≤ 1.5 MiB，几十张原图组成的会话也能落回十几 MB。
const MAX_IMAGE_EDGE = 2048
export const MAX_UPLOAD_IMAGE_BYTES = 1536 * 1024
const MIN_IMAGE_EDGE = 640
/** 同一尺寸下依次尝试的编码质量；仍超限则继续缩小边长 */
const QUALITY_STEPS = [0.86, 0.74, 0.62]
/** 边长收缩系数：原图过大时按比例继续缩 */
const EDGE_STEPS = [1, 0.75, 0.56, 0.42]

const readUploadImage = async (blob: Blob) => {
  const image = new Image()
  const url = URL.createObjectURL(blob)
  try {
    // 通过临时 URL 解码本地文件，从 naturalWidth 和 naturalHeight 读取图片本身的尺寸。
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

/** 浏览器可能回退到 PNG，上传文件的后缀以实际编码为准。 */
const toUploadFile = (file: File, blob: Blob) => {
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.slice('image/'.length)
  const name = file.name.replace(/\.[^.]*$/, '') + '.' + extension
  return new File([blob], name, { type: blob.type, lastModified: file.lastModified })
}

/** 复用旧 file_id 前，用本地原件检查当时上传的图片是否超限（边长或体积）。 */
export const isUploadImageOversized = async (blob: Blob): Promise<boolean> => {
  if (blob.size > MAX_UPLOAD_IMAGE_BYTES) {
    return true
  }
  return (await readUploadImage(blob)).longestEdge > MAX_IMAGE_EDGE
}

/**
 * 图片在尺寸与体积上限内时返回原文件；否则生成压缩后的上传副本：
 * 先按长边缩到 2048px 以内，再逐级降低编码质量，仍超限就继续缩小边长。
 * JPEG 沿用原格式；PNG/GIF（可能带透明通道）改用 WebP，避免透明区域变黑。
 */
export const resizeUploadImage = async (file: File, signal?: AbortSignal): Promise<File> => {
  signal?.throwIfAborted()
  const { image, longestEdge } = await readUploadImage(file)
  signal?.throwIfAborted()
  if (longestEdge <= MAX_IMAGE_EDGE && file.size <= MAX_UPLOAD_IMAGE_BYTES) {
    return file
  }

  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
  const canvas = document.createElement('canvas')
  try {
    let smallest: Blob | null = null
    for (const factor of EDGE_STEPS) {
      // 宽和高按同一比例缩放，横图与竖图都落到同一个长边上限；短边至少 1 像素。
      const edge = Math.max(
        MIN_IMAGE_EDGE,
        Math.round(Math.min(MAX_IMAGE_EDGE, longestEdge) * factor)
      )
      const scale = edge / longestEdge
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Cannot resize image')
      }
      // 缩放副本可能被复用，先清空上一轮的像素。
      context.clearRect(0, 0, canvas.width, canvas.height)
      // drawImage 将整张图重采样到目标尺寸的画布上。动图在这一步只绘制一帧。
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITY_STEPS) {
        const blob = await encode(canvas, type, quality)
        signal?.throwIfAborted()
        if (!smallest || blob.size < smallest.size) {
          smallest = blob
        }
        if (blob.size <= MAX_UPLOAD_IMAGE_BYTES) {
          return toUploadFile(file, blob)
        }
      }
      if (canvas.width <= MIN_IMAGE_EDGE && canvas.height <= MIN_IMAGE_EDGE) {
        break
      }
    }
    if (!smallest) {
      throw new Error('Cannot encode image')
    }
    // 已经压到最小边长仍超限：上传能拿到的最小副本，发送端会按总量再做裁剪。
    return toUploadFile(file, smallest)
  } finally {
    canvas.width = canvas.height = 0
  }
}

