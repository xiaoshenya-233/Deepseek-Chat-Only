/** 原生壳一次转交的附件大小上限：base64 走 JS 桥，过大既慢又容易被系统拒绝。 */
export const MAX_NATIVE_ATTACHMENT_BYTES = 32 * 1024 * 1024

const toBase64 = (bytes: Uint8Array) => {
  const chunk = 0x8000
  let text = ''
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(text)
}

/**
 * 用系统应用打开附件：Electron 写到临时文件后 shell.openPath，Android 走 Intent。
 * 没有原生通道（纯浏览器）时返回 false，由调用方退回新标签页。
 * 超过上限时抛出 'attachment-too-large'。
 */
export const openAttachmentInSystemApp = async (name: string, url: string): Promise<boolean> => {
  const native = window.DeepseekNative
  if (typeof native?.openAttachment !== 'function') {
    return false
  }
  const blob = await (await fetch(url)).blob()
  if (blob.size > MAX_NATIVE_ATTACHMENT_BYTES) {
    throw new Error('attachment-too-large')
  }
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()))
  // Android 的实现是同步的 void，Electron 返回布尔值
  const result = await native.openAttachment(name, blob.type || 'application/octet-stream', data)
  return result !== false
}
