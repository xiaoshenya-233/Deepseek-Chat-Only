import { create } from 'zustand'
import { showToast } from '../../components/base/toastState.js'

/** 待裁剪的头像：图片已选好，等待用户在裁剪弹窗里确认 1:1 区域 */
export type AvatarCropRequest = {
  sessionId: string
  title: string
  file: File
}

export const useAvatarCrop = create<{ request: AvatarCropRequest | null }>(() => ({ request: null }))

export const openAvatarCrop = (request: AvatarCropRequest) => useAvatarCrop.setState({ request })

export const closeAvatarCrop = () => useAvatarCrop.setState({ request: null })

/** 头像 / 表情包都只接受图片，其他类型直接拒绝，不写进 IndexedDB */
export const isImageFile = (file: File) => file.type.startsWith('image/')

let picker: HTMLInputElement | null = null
let pending: { sessionId: string; title: string } | null = null

const getPicker = () => {
  if (picker) {
    return picker
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.hidden = true
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    const target = pending
    pending = null
    // 清空以便再次选择同一张图片
    input.value = ''
    if (!file || !target) {
      return
    }
    if (!isImageFile(file)) {
      showToast({ key: 'sessionAvatarNeedImage', type: 'error' })
      return
    }
    openAvatarCrop({ ...target, file })
  })
  document.body.appendChild(input)
  picker = input
  return input
}

/**
 * 选一张图片作为会话头像：列表头像、菜单「更换头像」、聊天里的 AI 头像都走这里。
 * 选完先进入 1:1 裁剪弹窗，确认后才落库。
 */
export const pickAvatarFor = (sessionId: string, title: string) => {
  pending = { sessionId, title }
  const input = getPicker()
  input.value = ''
  input.click()
}
