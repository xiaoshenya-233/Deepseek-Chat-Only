/**
 * 会话总览 → 消息列表的跳转总线。
 *
 * 总览按钮在标题栏（SessionView），滚动与分页只在列表内部（MessageList），
 * 用一个极轻的订阅表把两者解耦：点击总览项只广播 messageId，由列表负责
 * 扩充挂载范围、滚动定位并短暂高亮。
 */
type JumpListener = (messageId: string) => void

const listeners = new Set<JumpListener>()

/** 请求定位到某条消息；没有列表在监听时安全地忽略 */
export const requestJumpToMessage = (messageId: string) => {
  for (const listener of listeners) {
    listener(messageId)
  }
}

export const onJumpToMessage = (listener: JumpListener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
