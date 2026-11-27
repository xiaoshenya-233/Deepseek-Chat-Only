import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好：默认跟随系统；auto 按当前时区的日出日落切换 */
export type ThemePreference = 'light' | 'dark' | 'system' | 'auto'

/** 界面布局：效率模式沿用原来的会话列表；休闲模式是聊天软件式的联系人分栏 */
export type UiMode = 'efficiency' | 'casual'

/** 界面缩放：部分高分屏 / 小屏设备上默认字号偏大或偏小，这里按比例整体缩放 */
export const UI_SCALE_MIN = 0.8
export const UI_SCALE_MAX = 1.5
export const UI_SCALE_STEP = 0.1

export const clampUiScale = (value: number) => {
  if (!Number.isFinite(value)) {
    return 1
  }
  const stepped = Math.round(value * 100) / 100
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped))
}

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、界面布局、界面缩放 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  uiMode: UiMode
  uiScale: number
  /**
   * 自动摘要：轮次变多时把较早的对话压缩成摘要，减少每轮重发的 token
   */
  autoSummary: boolean
  /** 折叠思考过程：收起所有「已思考」正文，只留标题行（仍可单条展开） */
  collapseThinking: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  uiMode: 'chat-demo:ui-mode',
  uiScale: 'chat-demo:ui-scale',
  autoSummary: 'chat-demo:auto-summary',
  collapseThinking: 'chat-demo:collapse-thinking',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时保持原有布局（效率模式），避免升级后界面突变 */
const initialUiMode = (): UiMode => (read(KEYS.uiMode) === 'casual' ? 'casual' : 'efficiency')

const initialUiScale = (): number => {
  const saved = Number(read(KEYS.uiScale))
  return saved ? clampUiScale(saved) : 1
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  uiMode: initialUiMode(),
  uiScale: initialUiScale(),
  // 默认开启：写入的是本机摘要，不改变历史数据，可随时在设置里关闭
  autoSummary: read(KEYS.autoSummary) !== 'false',
  // 默认展开：思考过程对新用户更有信息量，需要时在设置里一键折叠
  collapseThinking: read(KEYS.collapseThinking) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/** 切换界面布局；两种模式共用同一份会话数据与输入框 */
export const setUiMode = (uiMode: UiMode) => {
  write(KEYS.uiMode, uiMode)
  useSettings.setState({ uiMode })
}

/** 整体界面缩放（0.8–1.5）：只在 html 上加 CSS zoom，布局尺寸随之换算 */
export const setUiScale = (value: number) => {
  const uiScale = clampUiScale(value)
  write(KEYS.uiScale, String(uiScale))
  useSettings.setState({ uiScale })
}

/** 自动摘要开关 */
export const setAutoSummary = (autoSummary: boolean) => {
  write(KEYS.autoSummary, String(autoSummary))
  useSettings.setState({ autoSummary })
}

/** 折叠思考过程：改这一处，所有已显示与后续新渲染的思考区都会跟随 */
export const setCollapseThinking = (collapseThinking: boolean) => {
  write(KEYS.collapseThinking, String(collapseThinking))
  useSettings.setState({ collapseThinking })
}
