import { closeTopModal } from '../components/base/Modal.js'
import { closeImageViewer, useImageViewer } from '../components/files/imageViewerState.js'
import { closeMermaidPreview, useMermaidPreview } from '../components/markdown/mermaidPreviewState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { newChat, useChatStore } from '../services/chat/store.js'

/**
 * 系统返回键（Android 实体/手势返回）：
 * 先关最上层的弹窗或浮层（设置、确认框、图片预览、脑图放大、搜索面板、侧栏抽屉），
 * 再退回新对话页；都没有可退的内容时返回 false，由原生决定退回上一页或退出应用。
 */
export const handleAppBack = (): boolean => {
  if (closeTopModal()) {
    return true
  }
  if (useImageViewer.getState().url) {
    closeImageViewer()
    return true
  }
  if (useMermaidPreview.getState().markup) {
    closeMermaidPreview()
    return true
  }
  if (useSearchPanel.getState().entry) {
    closeSearchPanel()
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  if (useChatStore.getState().activeId !== null) {
    newChat()
    return true
  }
  return false
}
