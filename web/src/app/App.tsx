import { useEffect, useRef } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { BackupProgressBar } from '../components/backup/BackupProgressBar.js'
import { ImageViewer } from '../components/files/ImageViewer.js'
import { MermaidPreview } from '../components/markdown/MermaidPreview.js'
import { CasualShell, CasualSkeleton } from '../components/casual/CasualShell.js'
import { AvatarCropDialog } from '../components/casual/AvatarCropDialog.js'
import { initSessionAvatars, initStickers } from '../services/chat/assets.js'
import { installDebugHooks } from '../services/chat/debug.js'
import { handleAppBack } from './backNavigation.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const uiMode = useSettings((state) => state.uiMode)
  const uiScale = useSettings((state) => state.uiScale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const contentRef = useRef<HTMLDivElement>(null)

  usePreventPageScroll(isMobile)

  // 安卓壳的返回键回调：先关浮层，再退回新对话页；未处理时返回 false 交回原生
  useEffect(() => {
    window.__dscHandleBack = handleAppBack
    return () => {
      delete window.__dscHandleBack
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 界面缩放：只在 html 上加 CSS zoom，Chromium 会把布局视口一起换算，弹窗与 100vh 都不受影响。
  // 但视口单位（100dvh / visualViewport 读数）不会被 zoom 换算，移动端整屏容器按 1/缩放
  // 折算回可见高度，否则放大后底部输入框会被裁到屏幕外。
  useEffect(() => {
    const root = document.documentElement
    if (Math.abs(uiScale - 1) < 0.001) {
      root.style.removeProperty('zoom')
    } else {
      root.style.zoom = String(uiScale)
    }
    if (Math.abs(uiScale - 1) < 0.001) {
      root.style.removeProperty('--app-frame-scale')
    } else {
      root.style.setProperty('--app-frame-scale', String(1 / uiScale))
    }
  }, [uiScale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  // 切换会话（含回到新对话页）时重放内容区的进入动画；休闲模式的分栏切换不需要整块动画
  useEffect(() => {
    if (uiMode === 'casual') {
      return
    }
    const el = contentRef.current
    if (!el) {
      return
    }
    el.classList.remove(styles.viewEnter)
    // 读取一次布局，强制浏览器丢弃上一帧后再加类，动画才会重新播放
    void el.offsetWidth
    el.classList.add(styles.viewEnter)
  }, [activeId, uiMode])

  useEffect(() => {
    void initChat()
    // 会话头像与表情包存在 IndexedDB，进页面时一次性载入
    void initSessionAvatars()
    void initStickers()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
    installDebugHooks()
  }, [])

  /** 效率模式的整块加载 / 失败态；休闲模式只在右侧主区里显示 */
  const renderLoading = (initPhase: boolean) => (
    <div className={styles.loadingView}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.loadingState} role="status" aria-live="polite">
        <span>
          {(initPhase ? initError : sessionLoadError)
            ? t(initPhase ? 'sessionListLoadFailed' : 'sessionLoadFailed')
            : t('sessionLoading')}
        </span>
        {(initPhase ? initError : sessionLoadError) ? (
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              if (initPhase) {
                void initChat()
              } else if (activeId !== null) {
                selectSession(activeId)
              }
            }}
          >
            {t('retry')}
          </Button>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : uiMode === 'casual' || siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div ref={contentRef} className={styles.content}>
            {siderCollapsed && uiMode !== 'casual' ? <CollapsedSider /> : null}
            {!ready ? (
              uiMode === 'casual' ? <CasualSkeleton /> : renderLoading(true)
            ) : uiMode === 'casual' ? (
              // 休闲模式外壳始终挂载：切换会话只替换右侧主区，导航与列表不重建
              <CasualShell
                session={session}
                streaming={streaming}
                loadingSessionId={activeId !== null && !session ? activeId : null}
                loadError={sessionLoadError}
              />
            ) : activeId !== null && !session ? (
              renderLoading(false)
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <BackupProgressBar />
      <ImageViewer />
      <MermaidPreview />
      <AvatarCropDialog />
      <Toast />
    </>
  )
}
