'use strict'

// Electron shell for the same web build that the Android shell ships.
// The renderer keeps using window.DeepseekNative, so static/js/download-bridge.js
// works unchanged on both platforms; here the bridge is implemented with IPC.

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, protocol, screen, session, shell } =
  require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SCHEME = 'app'
const HOST = 'bundle'
const START_URL = `${SCHEME}://${HOST}/index.html`
const WEB_ROOT = path.join(__dirname, 'web')
const SMOKE = process.argv.includes('--smoke')
/** 只读体检：打印 IndexedDB 里的会话/图片数量，排查数据丢失（配合 --data-dir 使用） */
const DUMP_STORE = process.argv.includes('--dump-store')
const DEVTOOLS = process.argv.includes('--dev')
const CAPTURE_DIR = (() => {
  const index = process.argv.indexOf('--capture')
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : null
})()
/** 配合 --capture：先把界面布局切到 efficiency / casual 再截图 */
const CAPTURE_UI = (() => {
  const index = process.argv.indexOf('--capture-ui')
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : null
})()
const HEADLESS = (SMOKE || Boolean(CAPTURE_DIR)) && !process.argv.includes('--show-window')
/** 本机 QA：--import-test <zip> 驱动「数据管理 → 导入」并采样进度条（见 qa/import-test.js） */
const IMPORT_TEST = (() => {
  const index = process.argv.indexOf('--import-test')
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : null
})()
const IMPORT_TEST_CANCEL = process.argv.includes('--import-test-cancel')
/** 配合 --import-test：导入后打开会话、点开图片预览并截图（验证附件查看） */
const IMPORT_TEST_VIEWER = process.argv.includes('--import-test-viewer')
/** 配合 --import-test：检查会话菜单定位与编辑态附件（截图 + 结果打印） */
const IMPORT_TEST_MENU = process.argv.includes('--import-test-menu')
/** 配合 --import-test：检查「日出日落」主题选项与每对话提示词 */
const IMPORT_TEST_PROMPT = process.argv.includes('--import-test-prompt')
/** 配合 --import-test：检查消息分页、脑图放大/保存、提示词统一管理 */
const IMPORT_TEST_UI = process.argv.includes('--import-test-ui')
/** 配合 --import-test：检查置顶、自由选择导出、批量删除、移动端全屏弹窗 */
const IMPORT_TEST_MANAGE = process.argv.includes('--import-test-manage')
/** 配合 --import-test：检查脑图拖动/滚轮缩放、返回键逻辑 */
const IMPORT_TEST_POLISH = process.argv.includes('--import-test-polish')
/** 配合 --import-test：检查导入与选图的图片压缩 */
const IMPORT_TEST_COMPRESS = process.argv.includes('--import-test-compress')
/** 配合 --import-test：检查「从链接导入」整条链路（下载 → 覆盖确认 → 导入） */
const IMPORT_TEST_URL = process.argv.includes('--import-test-url')
/** 配合 --import-test：检查附件三类别面板、设置里「对话管理 / 提示词管理」两个隔离入口 */
const IMPORT_TEST_PANELS = process.argv.includes('--import-test-panels')
/** 配合 --import-test：导出所选对话，校验 ZIP 条目顺序与能否再次导入 */
const IMPORT_TEST_EXPORT = process.argv.includes('--import-test-export')
/** 配合 --import-test：检查编辑消息里「一个按钮展开三类附件」 */
const IMPORT_TEST_EDIT_ATTACH = process.argv.includes('--import-test-edit-attach')
/** 配合 --import-test：检查「回到底部 / 对话总览跳转 / 折叠全部思考」 */
const IMPORT_TEST_NAV = process.argv.includes('--import-test-nav')
/** 一次性恢复：`--restore-file <官方导出 zip>` 导入到当前数据目录 */
const RESTORE_FILE = (() => {
  const index = process.argv.indexOf('--restore-file')
  return index > 0 ? process.argv[index + 1] : null
})()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const DATA_DIR_NAME = 'DeepseekChatOnly'
const LEGACY_DATA_DIRS = ['DeepSeek Chat (API)', 'dsc-desktop']
/** 安装目录内的数据子目录名 */
const INSTALL_DATA_FOLDER = 'data'
/** NSIS 钩子在安装目录旁边留的快照目录名（覆盖安装/卸载时用） */
const SIBLING_BACKUP_NAME = 'DeepseekChatOnly-data'
/** 只有带这个标记的兄弟目录才是安装器自己做的过渡快照（可以静默恢复、自动清理） */
const SNAPSHOT_MARKER = '.dsc-upgrade-snapshot'
/** 数据目录里的标记：表示当前安装的版本已带「覆盖安装保留 data」的钩子，安装器无需再拍快照 */
const SAFE_UNINSTALL_MARKER = '.dsc-safe-uninstall'

/**
 * 数据目录规范：
 * - **安装版 / 免安装版 / 便携版 / 开发运行**：统一用「程序目录」下的 `data\`
 *   安装版 = exe 所在目录；portable 单文件 = `PORTABLE_EXECUTABLE_DIR`；开发运行 = 仓库 `desktop\`
 * - 安装目录不可写（例如装到 `C:\Program Files`）：回退 `%LOCALAPPDATA%\DeepseekChatOnly`，仍是固定位置
 * - 首次启动目标为空时，从旧位置**复制**数据（源保留），完成后询问是否删除旧目录：
 *   `%LOCALAPPDATA%\DeepseekChatOnly`（上一版的位置）、上次记录的数据目录、`%APPDATA%\DeepseekChatOnly`、更早的目录名
 * - 每次启动把实际目录写进 `%LOCALAPPDATA%\DeepseekChatOnly.locations.json`，
 *   即使以后装到别的路径，也能据此把旧数据带回来
 * - `--data-dir` 始终优先（QA / 多开）
 */
const resolveInstallRoot = () => {
  // electron-builder 的 portable 目标会解压到临时目录运行，真实位置由该变量给出
  const portable = process.env.PORTABLE_EXECUTABLE_DIR
  if (portable) {
    return path.resolve(portable)
  }
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  }
  // 开发运行：仓库里的 desktop 目录（注意用 app.getAppPath，避免落到 node_modules\electron\dist）
  return app.getAppPath()
}


const ensureWritable = (target) => {
  try {
    fs.mkdirSync(target, { recursive: true })
    const probe = path.join(target, '.dsc-write-test')
    fs.writeFileSync(probe, 'ok')
    fs.rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** 把旧目录的数据复制到新位置；逐项容错，源目录保留作备份（绝不删除用户数据） */
const copyDirectoryInto = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  let copied = 0
  const failed = []
  for (const entry of fs.readdirSync(from)) {
    if (MIGRATE_SKIP.has(entry)) {
      continue
    }
    try {
      fs.cpSync(path.join(from, entry), path.join(to, entry), { recursive: true, force: true })
      copied += 1
    } catch (error) {
      failed.push(`${entry} (${error.code || error.message})`)
    }
  }
  const missing = MIGRATE_REQUIRED.filter((name) => !fs.existsSync(path.join(to, name)))
  if (missing.length === 0) {
    return { ok: true, copied, failed }
  }
  console.warn('[data] legacy data incomplete, missing:', missing.join(', '), failed.slice(0, 3).join('; '))
  return { ok: false, copied, failed }
}

const hasChatData = (directory) =>
  fs.existsSync(path.join(directory, 'IndexedDB')) &&
  fs.existsSync(path.join(directory, 'Local Storage'))

/** 迁移时跳过的缓存/锁文件：可再生、体积大且经常被占用 */
const MIGRATE_SKIP = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Shared Dictionary',
  'DIPS',
  'DIPS-wal',
  'Local State',
  'lockfile',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'blob_storage',
])
/** 只要这两项复制成功就算迁移完成（对话与 API Key/设置） */
const MIGRATE_REQUIRED = ['IndexedDB', 'Local Storage']

/** %LOCALAPPDATA%（Electron 某些环境取不到时按 appData 的同级推算） */
const localAppDataDir = () => {
  try {
    return app.getPath('localAppData')
  } catch {
    // ignore
  }
  const roaming = app.getPath('appData')
  const local = path.join(path.dirname(roaming), 'Local')
  return fs.existsSync(local) ? local : roaming
}

/** 记录「上次实际使用的数据目录」：安装路径变了也能找回旧数据 */
const locationsFile = () => path.join(localAppDataDir(), `${DATA_DIR_NAME}.locations.json`)

const readLastDataDir = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(locationsFile(), 'utf8'))
    return typeof parsed?.dataDir === 'string' ? parsed.dataDir : null
  } catch {
    return null
  }
}

const rememberDataDir = (target) => {
  try {
    const file = locationsFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const last = readLastDataDir()
    const previous = last && path.resolve(last) !== path.resolve(target) ? [last] : []
    fs.writeFileSync(
      file,
      JSON.stringify({ dataDir: target, previous, updatedAt: new Date().toISOString() }, null, 2)
    )
  } catch (error) {
    console.warn('[data] unable to remember data directory:', error.message)
  }
}

/** 固定位置（安装目录不可写时的回退）：Windows 用 LOCALAPPDATA */
const fixedDataDirectory = () => path.join(localAppDataDir(), DATA_DIR_NAME)

/** 程序目录下的 data\：安装版「安装目录内」，开发运行是 desktop\data */
const installDataDirectory = () => path.join(resolveInstallRoot(), INSTALL_DATA_FOLDER)

/** 安装器在覆盖安装时留下的过渡快照目录（安装目录的兄弟目录，带标记文件） */
const upgradeSnapshotDirectory = () =>
  path.join(path.dirname(resolveInstallRoot()), SIBLING_BACKUP_NAME)

const isUpgradeSnapshot = (directory) => {
  try {
    return fs.existsSync(path.join(directory, SNAPSHOT_MARKER))
  } catch {
    return false
  }
}

/** 本次启动实际用到的旧数据来源，用于「是否删除旧目录」的询问 */
const migrationSources = []
/** 另外发现的旧目录（本次未导入，仅在询问里展示） */
const legacyDirs = []

const formatSize = (bytes) => {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  }
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}


function applyDataDirectory(target, note) {
  fs.mkdirSync(target, { recursive: true })
  app.setPath('userData', target)
  try {
    app.setPath('sessionData', target)
  } catch {
    // 旧版本 Electron 没有 sessionData，userData 已覆盖同一目录。
  }
  console.log(`[data] data directory${note ? ` (${note})` : ''}:`, target)
  // 临时目录（--data-dir，常用于 QA/多开）不写位置记录，避免覆盖真实用户目录
  if (note !== 'override') {
    rememberDataDir(target)
    // 告诉下次安装程序：这一版已经能原地保留 data，不需要再拍 195MB 快照
    try {
      fs.writeFileSync(path.join(target, SAFE_UNINSTALL_MARKER), 'v2\n')
    } catch {}
    // 数据已就位（覆盖安装时 data 会被原地保留），过渡快照就是多余副本，静默清掉
    const snapshot = upgradeSnapshotDirectory()
    if (
      path.resolve(snapshot) !== path.resolve(target) &&
      isUpgradeSnapshot(snapshot) &&
      hasChatData(target)
    ) {
      try {
        removeDirectoryWithRetry(snapshot)
        console.log('[data] removed redundant upgrade snapshot:', snapshot)
      } catch (error) {
        console.warn('[data] unable to remove upgrade snapshot:', error.message)
      }
    }
  }
}

/** 回退方案：%APPDATA%\DeepseekChatOnly（固定目录不可写时） */
function useAppDataFallback() {
  const appData = app.getPath('appData')
  const target = path.join(appData, DATA_DIR_NAME)
  migrateInto(target)
  applyDataDirectory(target, 'fallback')
}

/** 统计 IndexedDB 里的图片原件数量与总体积，用来判断目标目录是不是空壳 */
const dataFootprint = (directory) => {
  const stats = { blobs: 0, bytes: 0 }
  const walk = (current) => {
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      try {
        stats.bytes += fs.statSync(full).size
      } catch {}
      if (current.includes('.indexeddb.blob')) {
        stats.blobs += 1
      }
    }
  }
  walk(path.join(directory, 'IndexedDB'))
  return stats
}

/** 目标看起来是「搭好框架但没内容」的空壳（没有图片、库很小） */
const looksBlank = (stats) => stats.blobs === 0 && stats.bytes < 8 * 1024 * 1024

/** 目标为空时，从历史位置复制数据进来（源目录一律保留，交给用户决定是否删除） */
function migrateInto(target) {
  const targetHasData = hasChatData(target)
  const targetStats = targetHasData ? dataFootprint(target) : { blobs: 0, bytes: 0 }
  const appData = app.getPath('appData')
  const extra = (process.env.DSC_EXTRA_LEGACY_DIR || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  const candidates = [
    // 手动指定（调试/老数据在别的盘），优先级最高
    ...extra,
    // 上一版把数据放这里（固定目录），里面通常是最新数据
    fixedDataDirectory(),
    // 覆盖安装时安装器做的过渡快照（带标记，属于「自己的备份」，恢复后静默清理）
    upgradeSnapshotDirectory(),
    readLastDataDir(),
    path.join(appData, DATA_DIR_NAME),
    ...LEGACY_DATA_DIRS.map((name) => path.join(appData, name)),
  ].filter((item) => typeof item === 'string')
  const seen = new Set([path.resolve(target)])
  for (const previous of candidates) {
    if (!previous) {
      continue
    }
    const resolved = path.resolve(previous)
    if (seen.has(resolved)) {
      continue
    }
    seen.add(resolved)
    if (!fs.existsSync(path.join(resolved, 'IndexedDB'))) {
      continue
    }
    const sourceStats = dataFootprint(resolved)
    // 目标已有真实数据就不动；只有「空壳 + 明显更完整的旧库」才允许覆盖
    const adopt =
      !targetHasData ||
      (looksBlank(targetStats) &&
        sourceStats.bytes >= Math.max(targetStats.bytes * 4, 32 * 1024 * 1024) &&
        sourceStats.blobs > 0)
    if (!adopt) {
      // 覆盖安装的过渡快照属于「自己的备份」，不当作旧数据目录列出来
      if (!isUpgradeSnapshot(resolved)) {
        legacyDirs.push({ dir: resolved, size: sourceStats.bytes })
      }
      continue
    }
    // 只从第一个可用来源复制，避免后面的旧目录把刚导入的数据覆盖掉
    if (migrationSources.length === 0) {
      if (copyDirectoryInto(resolved, target).ok) {
        if (isUpgradeSnapshot(resolved)) {
          console.log(`[data] restored data from upgrade snapshot ${resolved}`)
          try {
            removeDirectoryWithRetry(resolved)
          } catch (error) {
            console.warn('[data] unable to remove upgrade snapshot:', error.message)
          }
          // 快照就是最新的完整副本，恢复后立即结束，绝不能再被更旧的来源覆盖
          return
        }
        console.log(
          `[data] imported data from ${resolved} (source kept${targetHasData ? ', replaced blank target' : ''})`
        )
        migrationSources.push(resolved)
        continue
      }
    }
    if (!isUpgradeSnapshot(resolved)) {
      legacyDirs.push({ dir: resolved, size: sourceStats.bytes })
    }
  }
}

function prepareDataDirectory() {
  try {
    // --data-dir <path>：开发/自动化测试使用独立数据目录，可与已安装版本同时运行
    const flagIndex = process.argv.indexOf('--data-dir')
    const override = flagIndex > 0 ? process.argv[flagIndex + 1] : null
    if (override) {
      applyDataDirectory(path.resolve(override), 'override')
      return
    }

    // 主方案：程序目录内的 data\（安装目录 / exe 旁 / 仓库 desktop 下）
    const target = installDataDirectory()
    if (ensureWritable(target)) {
      migrateInto(target)
      applyDataDirectory(target, 'install dir')
      return
    }
    console.warn('[data] install directory is not writable, falling back to local app data')

    // 回退：固定用户目录，仍然是「更新不换位置」的
    const fixed = fixedDataDirectory()
    if (ensureWritable(fixed)) {
      migrateInto(fixed)
      applyDataDirectory(fixed, 'fallback')
      return
    }
    console.warn('[data] local app data is not writable, falling back to roaming appData')
    useAppDataFallback()
  } catch (error) {
    console.error('[data] unable to prepare data directory:', error)
    // 兜底：至少把数据放进 appData，避免落到 Electron 的默认目录后「看起来全空」
    try {
      applyDataDirectory(path.join(app.getPath('appData'), DATA_DIR_NAME), 'emergency')
    } catch {}
  }
}

prepareDataDirectory()

if (process.env.DSC_BOOT_LOG) {
  try {
    fs.appendFileSync(process.env.DSC_BOOT_LOG, `boot ${new Date().toISOString()} argv=${process.argv.slice(1).join(' ')}\n`)
  } catch {}
}

let mainWindow = null
let download = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

function sanitizeName(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return fallback
  }
  return cleaned
}

function notifyTarget(ticket, ok, message) {
  if (!mainWindow || mainWindow.isDestroyed() || !ticket) {
    return
  }
  const script =
    'window.__deepseekDownloadTarget&&window.__deepseekDownloadTarget(' +
    `${JSON.stringify(ticket)},${ok ? 'true' : 'false'},` +
    `${JSON.stringify(String(message || ''))})`
  mainWindow.webContents.executeJavaScript(script).catch(() => {})
}

function safeWebPath(pathname) {
  const relative = decodeURIComponent(pathname || '/')
  const resolved = path.resolve(WEB_ROOT, '.' + (relative === '/' ? '/index.html' : relative))
  const root = path.resolve(WEB_ROOT) + path.sep
  return resolved.startsWith(root) ? resolved : null
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const DEFAULT_ZOOM_INDEX = 4
let zoomIndex = DEFAULT_ZOOM_INDEX

function stateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath(), 'utf8')) || {}
  } catch {
    return {}
  }
}

function persistWindowState(win) {
  if (!win || win.isDestroyed()) {
    return
  }
  try {
    const bounds = win.getNormalBounds()
    fs.writeFileSync(
      stateFilePath(),
      JSON.stringify({ ...bounds, maximized: win.isMaximized(), zoomIndex })
    )
  } catch {}
}

/** 只恢复仍然落在某个显示器工作区内的位置，避免拔掉外接屏后窗口跑到看不见的地方。 */
function restoreBounds(state) {
  const width = Number.isFinite(state.width) ? Math.max(380, Math.round(state.width)) : 1180
  const height = Number.isFinite(state.height) ? Math.max(520, Math.round(state.height)) : 820
  if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
    const visible = screen.getAllDisplays().some(({ workArea }) => {
      return (
        state.x < workArea.x + workArea.width - 80 &&
        state.x + width > workArea.x + 80 &&
        state.y < workArea.y + workArea.height - 40 &&
        state.y + height > workArea.y
      )
    })
    if (visible) {
      return { width, height, x: Math.round(state.x), y: Math.round(state.y) }
    }
  }
  return { width, height }
}

function setupWindowChrome(win) {
  const webContents = win.webContents
  const saved = loadWindowState()
  if (Number.isInteger(saved.zoomIndex) && saved.zoomIndex >= 0 && saved.zoomIndex < ZOOM_STEPS.length) {
    zoomIndex = saved.zoomIndex
  }
  webContents.setZoomFactor(ZOOM_STEPS[zoomIndex])

  const applyZoom = (index) => {
    zoomIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index))
    webContents.setZoomFactor(ZOOM_STEPS[zoomIndex])
    persistWindowState(win)
  }

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }
    if (input.key === 'F12' && DEVTOOLS) {
      webContents.toggleDevTools()
      event.preventDefault()
      return
    }
    const primary = process.platform === 'darwin' ? input.meta : input.control
    if (!primary) {
      return
    }
    if (input.key === '+' || input.key === '=') {
      applyZoom(zoomIndex + 1)
      event.preventDefault()
    } else if (input.key === '-' || input.key === '_') {
      applyZoom(zoomIndex - 1)
      event.preventDefault()
    } else if (input.key === '0') {
      applyZoom(DEFAULT_ZOOM_INDEX)
      event.preventDefault()
    }
  })

  // 没有应用菜单时 Electron 不提供默认右键菜单，这里补上剪贴板与链接操作。
  webContents.on('context-menu', (_event, params) => {
    const items = []
    if (params.linkURL) {
      items.push(
        { label: '在浏览器中打开链接', click: () => shell.openExternal(params.linkURL) },
        { label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }
    if (params.isEditable) {
      items.push(
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      )
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: '复制' }, { type: 'separator' }, { role: 'selectAll', label: '全选' })
    }
    if (DEVTOOLS) {
      items.push(
        { type: 'separator' },
        { label: '检查元素', click: () => webContents.inspectElement(params.x, params.y) }
      )
    }
    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: win })
    }
  })
}

async function runCapture(win, directory) {
  const sizes = [
    [1440, 900],
    [1024, 900],
    [1000, 800],
    [860, 760],
    [768, 800],
    [390, 844]
  ]
  const report = []
  try {
    fs.mkdirSync(directory, { recursive: true })
  } catch {}
  // 首次启动没有 API Key 会自动打开设置弹窗，截图前先按 Esc 关掉，拍到的才是新对话页
  try {
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`
    )
    await delay(300)
  } catch {}
  // --capture-ui：写入布局偏好后重载，拍另一种界面
  if (CAPTURE_UI) {
    try {
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const keys = await new Promise((resolve) => {
          const request = db.transaction('sessionSummaries').objectStore('sessionSummaries').getAllKeys()
          request.onsuccess = () => resolve(request.result || [])
          request.onerror = () => resolve([])
        })
        // 首页展示置顶与常用，截图前准备数据（只影响本次截图用的数据目录）
        localStorage.setItem('chat-demo:pinned-sessions', JSON.stringify(keys.slice(0, 3)))
        localStorage.setItem('chat-demo:session-activity', JSON.stringify(keys.slice(0, 6)))
        localStorage.setItem('chat-demo:casual-hidden', JSON.stringify(keys.slice(5, 6)))
        localStorage.setItem('chat-demo:ui-mode', ${JSON.stringify(CAPTURE_UI)})
        return keys.length
      })()`)
      console.log('CAPTURE_UI seeded sessions: ' + seeded)
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
      win.webContents.reload()
      await loaded
      await delay(1200)
      await win.webContents.executeJavaScript(
        `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`
      )
      await delay(400)
    } catch (error) {
      console.log('CAPTURE_UI_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-open：点开第一个会话，截会话页而不是首页
  if (process.argv.includes('--capture-open')) {
    try {
      const opened = await win.webContents.executeJavaScript(`(async () => {
        const listColumn = document.querySelector('[class*="listColumn-"]')
        if (listColumn) listColumn.dataset.probeMark = 'kept'
        const pane = document.querySelector('[class*="pane-"]')
        if (pane) pane.dataset.probeMark = 'kept'
        const row =
          document.querySelector('[class*="row-"]') ||
          document.querySelector('[class*="topicRow-"]')
        row?.click()
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return JSON.stringify({
          clicked: !!row,
          bubbles: document.querySelectorAll('[class*="casualBubble-"]').length,
          welcome: document.querySelectorAll('[class*="welcome-"]').length,
          listKept: document.querySelector('[class*="listColumn-"]')?.dataset.probeMark === 'kept',
          paneKept: document.querySelector('[class*="pane-"]')?.dataset.probeMark === 'kept',
          railItems: document.querySelectorAll('[class*="railItem-"]').length,
        })
      })()`)
      console.log('CAPTURE_OPEN ' + opened)
    } catch (error) {
      console.log('CAPTURE_OPEN_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-seed-stickers：截图前写入几张占位表情（仅用于布局/预览自检）
  if (process.argv.includes('--capture-seed-stickers')) {
    try {
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const existing = await new Promise((resolve) => {
          const count = db.transaction('stickers').objectStore('stickers').count()
          count.onsuccess = () => resolve(count.result)
          count.onerror = () => resolve(0)
        })
        if (existing > 0) return 0
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 160
        const ctx = canvas.getContext('2d')
        const colors = ['#f7c6d9', '#c9dcf7', '#cfeccb', '#f7e6b3']
        for (let index = 0; index < 8; index += 1) {
          ctx.fillStyle = colors[index % colors.length]
          ctx.fillRect(0, 0, 160, 160)
          ctx.fillStyle = '#2b2b2b'
          ctx.font = 'bold 72px sans-serif'
          ctx.fillText(String(index + 1), 52, 106)
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
          await new Promise((resolve, reject) => {
            const tx = db.transaction('stickers', 'readwrite')
            tx.objectStore('stickers').put({ id: 'seed-' + index, blob, createdAt: Date.now() - index })
            tx.oncomplete = resolve
            tx.onerror = () => reject(tx.error)
          })
        }
        db.close()
        return 8
      })()`)
      console.log('CAPTURE_SEED_STICKERS ' + seeded)
    } catch (error) {
      console.log('CAPTURE_SEED_STICKERS_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-sticker：打开输入框的表情包面板，便于截图检查
  if (process.argv.includes('--capture-sticker')) {
    try {
      const opened = await win.webContents.executeJavaScript(`(async () => {
        const button =
          document.querySelector('[aria-label="表情包"]') ||
          document.querySelector('[aria-label="Stickers"]')
        button?.click()
        await new Promise((resolve) => setTimeout(resolve, 800))
        return !!button
      })()`)
      console.log('CAPTURE_STICKER ' + opened)
    } catch (error) {
      console.log('CAPTURE_STICKER_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-hover-sticker：模拟悬停第一个表情，验证放大预览气泡
  if (process.argv.includes('--capture-hover-sticker')) {
    try {
      // 先做一次尺寸变化强制整帧重绘（隐藏窗口里新增的 portal 否则可能不进合成结果）
      win.setContentSize(1460, 940)
      await delay(700)
      const hovered = await win.webContents.executeJavaScript(`(async () => {
        const sticker = document.querySelector('[class*="sticker-"]')
        if (!sticker) return false
        const rect = sticker.getBoundingClientRect()
        sticker.dispatchEvent(new MouseEvent('mouseover', {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }))
        await new Promise((resolve) => setTimeout(resolve, 700))
        const preview = document.querySelector('[class*="preview-"]')
        const panel = document.querySelector('[class*="panel-"]')
        const stickerRect = sticker.getBoundingClientRect()
        const previewRect = preview ? preview.getBoundingClientRect() : null
        const hit = previewRect
          ? document.elementFromPoint(
              previewRect.left + previewRect.width / 2,
              previewRect.top + previewRect.height / 2
            )
          : null
        return JSON.stringify({
          preview: !!preview,
          panel: !!panel,
          sticker: [Math.round(stickerRect.left), Math.round(stickerRect.top)],
          rect: previewRect
            ? [Math.round(previewRect.left), Math.round(previewRect.top), Math.round(previewRect.width)]
            : null,
          hit: hit ? hit.className || hit.tagName : null,
          visibility: preview ? getComputedStyle(preview).visibility : null,
          opacity: preview ? getComputedStyle(preview).opacity : null,
        })
      })()`)
      console.log('CAPTURE_HOVER ' + hovered)
      // 多等一帧再截图，避免拿到尚未合成的画面；隐藏窗口需要手动触发一次重绘
      await delay(900)
      win.webContents.invalidate()
      await delay(400)
      const hoverShot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'sticker-hover.png'), hoverShot.toPNG())
    } catch (error) {
      console.log('CAPTURE_HOVER_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-tab <chats|contacts|settings>：切到休闲模式的某个页面再截图
  const captureTab = (() => {
    const index = process.argv.indexOf('--capture-tab')
    return index > 0 ? process.argv[index + 1] : null
  })()
  if (captureTab) {
    try {
      const map = { chats: 0, contacts: 1, settings: 2 }
      const index = map[captureTab] ?? 0
      const switched = await win.webContents.executeJavaScript(`(async () => {
        const buttons = document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')
        const button = buttons[${index}]
        button?.click()
        await new Promise((resolve) => setTimeout(resolve, 600))
        return !!button
      })()`)
      console.log('CAPTURE_TAB ' + captureTab + ' ' + switched)
    } catch (error) {
      console.log('CAPTURE_TAB_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-probe：打印休闲模式关键节点与每行预览（在 --capture-tab 之后执行）
  if (process.argv.includes('--capture-probe')) {
    try {
      const rowLimit = process.argv.includes('--capture-probe-full') ? 200 : 4
      const probe = await win.webContents.executeJavaScript(`JSON.stringify({
        bubbles: document.querySelectorAll('[class*="casualBubble-"]').length,
        avatars: document.querySelectorAll('[class*="casualAvatar-"]').length,
        tabItems: document.querySelectorAll('[class*="tabItem-"]').length,
        railItems: document.querySelectorAll('[class*="railItem-"]').length,
        listColumn: document.querySelectorAll('[class*="listColumn-"]').length,
        welcome: document.querySelectorAll('[class*="welcome-"]').length,
        greeting: (document.querySelector('[class*="greeting-"]') || {}).textContent || null,
        inputPlaceholder: (document.querySelector('textarea') || {}).placeholder || null,
        rows: [...document.querySelectorAll('[class*="row-"]')].slice(0, ${rowLimit}).map((row) => ({
          title: ((row.querySelector('[class*="rowTitle-"]') || {}).textContent || '').trim(),
          preview: ((row.querySelector('[class*="rowPreview-"]') || {}).textContent || '').trim(),
          pin: !!row.querySelector('[class*="rowPin-"]'),
          width: Math.round(row.getBoundingClientRect().width),
          left: Math.round(row.getBoundingClientRect().left),
        })),
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
      })`)
      console.log('CAPTURE_PROBE ' + probe)
    } catch (error) {
      console.log('CAPTURE_PROBE_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-row-menu [index]：打开某一行的 ⋯ 菜单并打印菜单项（默认第一行）
  if (process.argv.includes('--capture-row-menu')) {
    try {
      const menuIndex = (() => {
        const index = process.argv.indexOf('--capture-row-menu')
        const value = index >= 0 ? Number(process.argv[index + 1]) : 0
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
      })()
      const opened = await win.webContents.executeJavaScript(`(async () => {
        const row = document.querySelectorAll('[class*="row-"]')[${menuIndex}]
        const action = row?.querySelector('button')
        action?.click()
        await new Promise((resolve) => setTimeout(resolve, 500))
        const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
          (item.textContent || '').trim()
        )
        return JSON.stringify({ menu: !!document.querySelector('[role="menu"]'), items })
      })()`)
      console.log('CAPTURE_ROW_MENU ' + opened)
      await delay(400)
      const menuShot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'row-menu.png'), menuShot.toPNG())
    } catch (error) {
      console.log('CAPTURE_ROW_MENU_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-seed-previews：写入几条「脑图 / 代码 / 表格 / 图片」会话，验证列表预览的类型标签
  if (process.argv.includes('--capture-seed-previews')) {
    try {
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const fence = String.fromCharCode(96).repeat(3)
        const now = Date.now()
        const make = (id, title, last) => ({
          id,
          title,
          createdAt: now - 2000,
          updatedAt: now,
          rootMessageId: id + '-q',
          messages: [
            {
              id: id + '-q',
              role: 'user',
              content: '演示消息',
              files: [],
              createdAt: now - 2000,
              parentId: null,
              selectedChildId: id + '-a',
            },
            Object.assign({ id: id + '-a', role: 'assistant', createdAt: now, model: null, prefix: false, status: 'done', parentId: id + '-q' }, last),
          ],
        })
        const sessions = [
          make('seed-mindmap', '脑图预览演示', { blocks: [{ type: 'text', text: fence + 'mermaid\\nmindmap\\n  root((AI))\\n' + fence }] }),
          make('seed-code', '代码预览演示', { blocks: [{ type: 'text', text: fence + 'ts\\nconst answer = 42\\n' + fence }] }),
          make('seed-table', '表格预览演示', { blocks: [{ type: 'text', text: '| 项目 | 结果 |\\n| --- | --- |\\n| 内存 | 正常 |' }] }),
          make('seed-image', '图片预览演示', {
            blocks: [{ type: 'text', text: '' }],
          }),
        ]
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
          for (const session of sessions) {
            tx.objectStore('sessions').put(session)
            tx.objectStore('sessionSummaries').put({
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              fileIds: [],
            })
          }
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
        })
        db.close()
        return sessions.length
      })()`)
      console.log('CAPTURE_SEED_PREVIEWS ' + seeded)
      await win.webContents.reload()
      await delay(2600)
      // 重新切到「会话」页并打印前几行预览，核对类型标签（脑图/代码/表格）
      const seedRows = await win.webContents.executeJavaScript(`(async () => {
        const buttons = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
        const target = buttons.find((button) => /会话|Sessions/.test(button.textContent || ''))
        target?.click()
        await new Promise((resolve) => setTimeout(resolve, 900))
        return JSON.stringify([...document.querySelectorAll('[class*="row-"]')].slice(0, 8).map((row) => ({
          title: ((row.querySelector('[class*="rowTitle-"]') || {}).textContent || '').trim(),
          preview: ((row.querySelector('[class*="rowPreview-"]') || {}).textContent || '').trim(),
        })))
      })()`)
      console.log('CAPTURE_SEED_PREVIEW_ROWS ' + seedRows)
    } catch (error) {
      console.log('CAPTURE_SEED_PREVIEWS_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-contacts-preview：验证「会话」页右侧预览 + 继续聊天 + 局部刷新（不整页重建）
  if (process.argv.includes('--capture-contacts-preview')) {
    try {
      // --capture-preview-mobile：先缩到手机尺寸再走同一个流程（移动端应是直接进对话）
      if (process.argv.includes('--capture-preview-mobile')) {
        win.setContentSize(390, 844)
        await delay(900)
      }
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const text = (selector) => {
          const node = document.querySelector(selector)
          return node ? (node.textContent || '').trim() : null
        }
        const buttons = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
        const contactsTab = buttons.find((button) => /会话|Sessions/.test(button.textContent || ''))
        contactsTab?.click()
        await sleep(800)
        const listColumn = document.querySelector('[class*="listColumn-"]')
        if (listColumn) listColumn.dataset.probeMark = 'kept'
        const before = { pick: text('[class*="previewEmpty"]'), listKept: true }
        const row = document.querySelectorAll('[class*="row-"]')[1]
        row?.click()
        await sleep(900)
        const after = {
          title: text('[class*="previewTitle"]'),
          label: text('[class*="previewLabel"]'),
          body: (text('[class*="previewBody"]') || '').slice(0, 80),
          markdown: (() => {
            const md = document.querySelector('[class*="previewBody"] .ds-markdown')
            if (!md) return null
            const style = getComputedStyle(md)
            return { width: Math.round(md.getBoundingClientRect().width), maxWidth: style.maxWidth, className: md.className }
          })(),
          listKept: document.querySelector('[class*="listColumn-"]')?.dataset.probeMark === 'kept',
          hasContinue: [...document.querySelectorAll('button')].some((button) =>
            /继续聊天|Continue chatting/.test(button.textContent || '')
          ),
          rowHighlighted: document.querySelectorAll('[class*="rowActive"]').length,
        }
        const continueButton = [...document.querySelectorAll('button')].find((button) =>
          /继续聊天|Continue chatting/.test(button.textContent || '')
        )
        const doContinue = ${process.argv.includes('--capture-preview-stop') ? 'false' : 'true'}
        if (doContinue) {
          continueButton?.click()
          await sleep(1800)
        }
        const opened = doContinue
          ? {
              bubbles: document.querySelectorAll('[class*="casualBubble-"]').length,
              listKept: document.querySelector('[class*="listColumn-"]')?.dataset.probeMark === 'kept',
              listTitle: text('[class*="chatColumnTitle"]') || text('[class*="contactsTitle"]'),
              welcome: document.querySelectorAll('[class*="welcome-"]').length,
              frequent: JSON.parse(localStorage.getItem('chat-demo:session-activity') || '[]').length,
            }
          : null
        return JSON.stringify({ before, after, opened })
      })()`)
      console.log('CAPTURE_PREVIEW ' + result)
      await delay(500)
      const previewShot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'preview-pane.png'), previewShot.toPNG())
    } catch (error) {
      console.log('CAPTURE_PREVIEW_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-settings：打开设置 →「数据管理」，截图并打印 API Key 提示文案与链接
  if (process.argv.includes('--capture-settings')) {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const text = (node) => (node ? (node.textContent || '').trim() : '')
        const railSettings = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
          .find((button) => /^(设置|Settings)$/.test(text(button)))
        railSettings?.click()
        await sleep(600)
        let tab = [...document.querySelectorAll('button')]
          .find((button) => /^(数据管理|Data management)$/.test(text(button)))
        if (tab) {
          tab.click()
          await sleep(700)
        } else {
          const openButton = [...document.querySelectorAll('button')]
            .find((button) => /^(设置|Settings)$/.test(text(button)))
          openButton?.click()
          await sleep(700)
          tab = [...document.querySelectorAll('[role="tab"]')]
            .find((item) => /数据管理|Data management/.test(text(item)))
          tab?.click()
          await sleep(500)
        }
        const hint = document.querySelector('[class*="apiKeyHint"]')
        const link = hint ? hint.querySelector('a') : null
        return JSON.stringify({
          hint: text(hint),
          href: link ? link.getAttribute('href') : null,
          target: link ? link.getAttribute('target') : null,
          dialog: !!document.querySelector('[role="dialog"]'),
        })
      })()`)
      console.log('CAPTURE_SETTINGS ' + result)
      // 隐藏窗口里新弹出的 dialog 需要强制整帧重绘（改一次尺寸）才会进合成结果
      win.setContentSize(1442, 902)
      await delay(700)
      win.webContents.invalidate()
      await delay(500)
      const state = await win.webContents.executeJavaScript(
        `JSON.stringify({ dialog: !!document.querySelector('[role="dialog"]') })`
      )
      console.log('CAPTURE_SETTINGS_STATE ' + state)
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'settings-data.png'), shot.toPNG())
      win.setContentSize(1440, 900)
    } catch (error) {
      console.log('CAPTURE_SETTINGS_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-avatar：验证列表头像点击是否触发文件选择（脚本内屏蔽真实文件对话框）
  if (process.argv.includes('--capture-avatar')) {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const tabs = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
        tabs.find((button) => /会话|Sessions/.test(button.textContent || ''))?.click()
        await sleep(700)
        const original = HTMLInputElement.prototype.click
        let picked = null
        HTMLInputElement.prototype.click = function () {
          if (this.type === 'file') {
            picked = { accept: this.accept, multiple: this.multiple }
            return
          }
          return original.call(this)
        }
        const avatarButton = document.querySelector('[class*="avatarButton"]')
        const target = avatarButton ? avatarButton.firstElementChild : null
        target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await sleep(300)
        HTMLInputElement.prototype.click = original
        // 直接塞一张 200×120 的 PNG 到文件输入，验证「头像保存 + 落库」整条链路
        const input = document.querySelector('input[type=file][accept="image/*"]')
        let saved = null
        if (input) {
          const canvas = document.createElement('canvas')
          canvas.width = 200
          canvas.height = 120
          const context = canvas.getContext('2d')
          context.fillStyle = '#4d6bfe'
          context.fillRect(0, 0, 200, 120)
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
          const data = new DataTransfer()
          data.items.add(new File([blob], 'probe.png', { type: 'image/png' }))
          input.files = data.files
          input.dispatchEvent(new Event('change', { bubbles: true }))
          await sleep(2500)
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('chat-demo')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          const count = await new Promise((resolve) => {
            const total = db.transaction('sessionAvatars').objectStore('sessionAvatars').count()
            total.onsuccess = () => resolve(total.result)
            total.onerror = () => resolve(-1)
          })
          db.close()
          saved = {
            avatarImages: document.querySelectorAll('[class*="avatarImage"]').length,
            stored: count,
            dialogs: document.querySelectorAll('[role="dialog"]').length,
          }
        }
        return JSON.stringify({
          avatarButton: !!avatarButton,
          target: target ? target.tagName : null,
          picked,
          previewOpened: document.querySelectorAll('[class*="previewTitle"]').length,
          dialogs: document.querySelectorAll('[role="dialog"]').length,
          saved,
        })
      })()`)
      console.log('CAPTURE_AVATAR ' + result)
    } catch (error) {
      console.log('CAPTURE_AVATAR_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-avatar-crop：验证「点头像 → 1:1 裁剪 → 落库成正方形」整条链路
  if (process.argv.includes('--capture-avatar-crop')) {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const bubbleMode = ${process.argv.includes('--capture-avatar-crop-bubble') ? 'true' : 'false'}
        if (bubbleMode) {
          // 聊天页直接点开第一个会话，AI 气泡头像才是这次要点的目标
          document.querySelectorAll('[class*="row-"]')[0]?.click()
          await sleep(2000)
        } else {
          const tabs = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
          tabs.find((button) => /会话|Sessions/.test(button.textContent || ''))?.click()
          await sleep(700)
        }
        // 记录已有的头像 id，稍后只校验本次新增的那一条
        const readAvatars = async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('chat-demo')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          const records = await new Promise((resolve) => {
            const request = db.transaction('sessionAvatars').objectStore('sessionAvatars').getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => resolve([])
          })
          db.close()
          return records
        }
        const beforeIds = (await readAvatars()).map((record) => record.id)
        // 屏蔽真实文件对话框：只记录调用，稍后手动塞文件
        const original = HTMLInputElement.prototype.click
        HTMLInputElement.prototype.click = function () {
          if (this.type === 'file') {
            return
          }
          return original.call(this)
        }
        const avatarButton = document.querySelector('[class*="avatarButton"]')
        const bubbleAvatar = document.querySelector('[class*="casualAvatarButton"]')
        const avatar = ${process.argv.includes('--capture-avatar-crop-bubble') ? 'bubbleAvatar' : 'avatarButton ? avatarButton.firstElementChild : null'}
        avatar?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await sleep(400)
        HTMLInputElement.prototype.click = original
        // 找到刚创建的选择器 input，塞一张 300×200 的图片
        const pickers = [...document.querySelectorAll('input[type=file][accept="image/*"]')]
        const picker = pickers.at(-1) || null
        let opened = null
        if (picker) {
          const canvas = document.createElement('canvas')
          canvas.width = 300
          canvas.height = 200
          const context = canvas.getContext('2d')
          context.fillStyle = '#4d6bfe'
          context.fillRect(0, 0, 300, 200)
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, 150, 100)
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
          const data = new DataTransfer()
          data.items.add(new File([blob], 'probe.png', { type: 'image/png' }))
          picker.files = data.files
          picker.dispatchEvent(new Event('change', { bubbles: true }))
          await sleep(900)
          const dialog = document.querySelector('[role="dialog"]')
          const slider = dialog ? dialog.querySelector('input[type=range]') : null
          opened = {
            dialog: !!dialog,
            title: dialog ? (dialog.querySelector('h2, [id]') || {}).textContent || '' : '',
            slider: slider ? slider.value : null,
            confirm: [...document.querySelectorAll('button')].some((button) =>
              /^(确定|Confirm)$/.test((button.textContent || '').trim())
            ),
          }
        }
        const stopHere = ${process.argv.includes('--capture-avatar-crop-stop') ? 'true' : 'false'}
        const confirmButton = [...document.querySelectorAll('button')].find((button) =>
          /^(确定|Confirm)$/.test((button.textContent || '').trim())
        )
        if (!stopHere) {
          confirmButton?.click()
          await sleep(2000)
        }
        const savedRecords = await readAvatars()
        const added = savedRecords.filter((record) => !beforeIds.includes(record.id))
        const bitmap = added.length > 0 ? await createImageBitmap(added[0].blob) : null
        return JSON.stringify({
          avatar: !!avatar,
          pickers: pickers.length,
          opened,
          dialogClosed: document.querySelectorAll('[role="dialog"]').length === 0,
          saved: bitmap ? { width: bitmap.width, height: bitmap.height, total: savedRecords.length } : null,
          avatarImages: document.querySelectorAll('[class*="avatarImage"]').length,
        })
      })()`)
      console.log('CAPTURE_AVATAR_CROP ' + result)
      win.setContentSize(1442, 902)
      await delay(300)
      win.setContentSize(1440, 900)
    } catch (error) {
      console.log('CAPTURE_AVATAR_CROP_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-sticker-guard：验证表情包只能上传图片（非图片被拒绝并提示）
  if (process.argv.includes('--capture-sticker-guard')) {
    try {
      // 先切到桌面尺寸，移动端布局没有输入框里的表情包按钮
      win.setContentSize(1440, 900)
      await delay(1200)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const findStickerButton = () =>
          document.querySelector('[aria-label="表情包"]') ||
          document.querySelector('[aria-label="Stickers"]')
        // 首次打开可能还在读会话，等输入框里的表情包按钮出现
        for (let index = 0; index < 30 && !findStickerButton(); index += 1) {
          await sleep(200)
        }
        const openButton = findStickerButton()
        openButton?.click()
        await sleep(800)
        const input =
          document.querySelector('[class*="panel"] input[type=file]') ||
          [...document.querySelectorAll('input[type=file]')].find((node) =>
            (node.accept || '').includes('image')
          )
        if (!input) {
          return JSON.stringify({
            panel: false,
            button: !!openButton,
            labels: [...document.querySelectorAll('button[aria-label]')]
              .map((node) => node.getAttribute('aria-label'))
              .slice(0, 24),
          })
        }
        const count = () => document.querySelectorAll('[class*="cell"] img').length
        const before = count()
        const feed = async (file) => {
          const data = new DataTransfer()
          data.items.add(file)
          input.files = data.files
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
        await feed(new File(['not an image'], 'note.txt', { type: 'text/plain' }))
        await sleep(700)
        const toast = (document.querySelector('[class*="toast"]') || {}).textContent || null
        const afterText = count()
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const context = canvas.getContext('2d')
        context.fillStyle = '#f7c6d9'
        context.fillRect(0, 0, 64, 64)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        await feed(new File([blob], 'ok.png', { type: 'image/png' }))
        await sleep(1200)
        return JSON.stringify({
          panel: true,
          accept: input.accept,
          before,
          afterText,
          afterImage: count(),
          toast,
        })
      })()`)
      console.log('CAPTURE_STICKER_GUARD ' + result)
    } catch (error) {
      console.log(
        'CAPTURE_STICKER_GUARD_FAIL ' + (error instanceof Error ? error.message : String(error))
      )
    }
  }
  // --capture-data-stats：打印本地库的会话/文件/头像/表情数量，用于核对数据完整性
  if (process.argv.includes('--capture-data-stats')) {
    try {
      await delay(3000)
      const stats = await win.webContents.executeJavaScript(`(async () => {
        try {
          if (location.protocol !== 'app:') {
            return JSON.stringify({ error: 'wrong page', href: location.href })
          }
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('chat-demo')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error || new Error('open failed'))
            request.onblocked = () => reject(new Error('open blocked'))
          })
          const count = (store) =>
            new Promise((resolve) => {
              try {
                const request = db.transaction(store).objectStore(store).count()
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => resolve(-1)
              } catch (error) {
                resolve(-2)
              }
            })
          const stores = ['sessions', 'sessionSummaries', 'files', 'sessionAvatars', 'stickers']
          const result = {}
          for (const store of stores) {
            result[store] = await count(store)
          }
          result.version = db.version
          db.close()
          return JSON.stringify(result)
        } catch (error) {
          return JSON.stringify({ error: String((error && error.message) || error) })
        }
      })()`)
      console.log('CAPTURE_DATA_STATS ' + stats)
    } catch (error) {
      console.log('CAPTURE_DATA_STATS_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-prompt-check：验证会话自定义提示词是否进入请求的 system 字段
  if (process.argv.includes('--capture-prompt-check')) {
    try {
      win.setContentSize(1440, 900)
      await delay(1200)
      const MARKER = 'PROMPT-MARKER-8899'
      // 阶段一：直接写 localStorage（等价于点弹窗保存），再重载让 store 读到
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const summaries = await new Promise((resolve) => {
          const request = db.transaction('sessionSummaries').objectStore('sessionSummaries').getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        db.close()
        const target = summaries[0]
        if (!target) {
          return JSON.stringify({ ok: false })
        }
        const key = 'chat-demo:session-prompts'
        const current = JSON.parse(localStorage.getItem(key) || '{}')
        current[target.id] = '${MARKER} 回答时以「喵」结尾。'
        localStorage.setItem(key, JSON.stringify(current))
        return JSON.stringify({ ok: true, id: target.id, title: target.title })
      })()`)
      console.log('CAPTURE_PROMPT_SEED ' + seeded)
      const seedInfo = JSON.parse(seeded)
      if (!seedInfo.ok) {
        throw new Error('no session to seed')
      }
      await win.webContents.reload()
      await delay(3000)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const title = ${JSON.stringify(seedInfo.title)}
        // 打开目标会话（休闲模式是 row-，效率模式是 item-）
        const rows = [...document.querySelectorAll('[class*="row-"], [class*="item-"]')]
        const row = rows.find((node) => (node.textContent || '').includes(title)) || rows[0]
        row?.click()
        await sleep(2200)
        const promptButton = [...document.querySelectorAll('button[aria-label]')].find((button) =>
          /提示词|Prompt/i.test(button.getAttribute('aria-label') || '')
        )
        let captured = null
        const fetchCalls = []
        const originalFetch = window.fetch
        window.fetch = async (input, init) => {
          try {
            const url = typeof input === 'string' ? input : (input && input.url) || ''
            fetchCalls.push({ url: url.slice(-40), bodyType: typeof init?.body })
            if (typeof init?.body === 'string' && init.body.includes('stream')) {
              captured = JSON.parse(init.body)
            }
          } catch {}
          return new Response(JSON.stringify({ error: { message: 'probe-blocked' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const setValue = (element, value) => {
          const proto =
            element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
          element.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const input = document.querySelector('textarea[placeholder]')
        let inputValue = null
        let sendLabel = null
        let sendDisabled = null
        let bubbles = 0
        if (input) {
          setValue(input, '测试提示词注入')
          await sleep(300)
          inputValue = input.value
          const sendButton = [...document.querySelectorAll('button')].find((button) =>
            /发送|Send/i.test(button.getAttribute('aria-label') || '')
          )
          sendLabel = sendButton ? sendButton.getAttribute('aria-label') : null
          sendDisabled = sendButton
            ? {
                disabled: sendButton.disabled,
                ariaDisabled: sendButton.getAttribute('aria-disabled'),
                className: sendButton.className,
              }
            : null
          if (sendButton) {
            sendButton.click()
          } else {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          }
          await sleep(2000)
          bubbles = document.querySelectorAll('[class*="message-"]').length
        }
        window.fetch = originalFetch
        const settingsRaw = localStorage.getItem('chat-demo:settings') || ''
        const stored = localStorage.getItem('chat-demo:session-prompts') || ''
        return JSON.stringify({
          rowOpened: !!row,
          promptButton: !!promptButton,
          inputFound: !!input,
          inputValue,
          sendLabel,
          sendDisabled,
          bubbles,
          labels: [...document.querySelectorAll('button[aria-label]')]
            .map((node) => node.getAttribute('aria-label'))
            .slice(0, 12),
          storedHasMarker: stored.includes('${MARKER}'),
          hasApiKey: /"apiKey":"[^"]+"/.test(settingsRaw),
          settingsDialog: [...document.querySelectorAll('[role="dialog"]')].length,
          stopButton: [...document.querySelectorAll('button[aria-label]')].some((node) =>
            /停止|Stop/.test(node.getAttribute('aria-label') || '')
          ),
          requestCaptured: !!captured,
          fetchCalls,
          systemHasMarker: !!(captured && typeof captured.system === 'string' && captured.system.includes('${MARKER}')),
          systemPreview: captured && typeof captured.system === 'string' ? captured.system.slice(-90) : null,
        })
      })()`)
      console.log('CAPTURE_PROMPT_CHECK ' + result)
      const visible = await win.webContents.executeJavaScript(
        `(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400)`
      )
      console.log('CAPTURE_PROMPT_VIEW ' + visible)
    } catch (error) {
      console.log('CAPTURE_PROMPT_CHECK_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-zoom-test：验证在 html 上加 CSS zoom 是否还能铺满窗口（用于 UI 缩放方案）
  if (process.argv.includes('--capture-zoom-test')) {
    try {
      win.setContentSize(1440, 900)
      await delay(1200)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const measure = () => {
          const root = document.documentElement
          const frame = document.querySelector('[class*="frame"]')
          const rect = frame ? frame.getBoundingClientRect() : null
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            clientWidth: root.clientWidth,
            clientHeight: root.clientHeight,
            scrollWidth: root.scrollWidth,
            scrollHeight: root.scrollHeight,
            frame: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
          }
        }
        const before = measure()
        document.documentElement.style.zoom = '1.25'
        await sleep(600)
        const after = measure()
        // 打开设置弹窗，检查固定定位的遮罩是否仍然居中铺满
        const railSettings = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
          .find((button) => /^(设置|Settings)$/.test((button.textContent || '').trim()))
        railSettings?.click()
        await sleep(700)
        const entry = [...document.querySelectorAll('button')]
          .find((button) => /^(数据管理|Data management)$/.test((button.textContent || '').trim()))
        entry?.click()
        await sleep(800)
        const dialog = document.querySelector('[role="dialog"]')
        const dialogRect = dialog ? dialog.getBoundingClientRect() : null
        return JSON.stringify({
          before,
          after,
          dialog: dialogRect
            ? {
                width: Math.round(dialogRect.width),
                height: Math.round(dialogRect.height),
                left: Math.round(dialogRect.left),
                top: Math.round(dialogRect.top),
              }
            : null,
        })
      })()`)
      console.log('CAPTURE_ZOOM_TEST ' + result)
      win.setContentSize(1442, 902)
      await delay(400)
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'zoom-125.png'), shot.toPNG())
    } catch (error) {
      console.log('CAPTURE_ZOOM_TEST_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-prompt-wire：用 DevTools 协议抓取真实请求体，确认 system 里带上了自定义提示词
  if (process.argv.includes('--capture-prompt-wire')) {
    try {
      win.setContentSize(1440, 900)
      await delay(1200)
      const MARKER = 'PROMPT-WIRE-7788'
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        localStorage.setItem('chat-demo:debug', '1')
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const summaries = await new Promise((resolve) => {
          const request = db.transaction('sessionSummaries').objectStore('sessionSummaries').getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        db.close()
        const target =
          summaries.find((item) => (item.fileIds || []).length === 0) || summaries[0]
        if (!target) {
          return JSON.stringify({ ok: false })
        }
        const key = 'chat-demo:session-prompts'
        const current = JSON.parse(localStorage.getItem(key) || '{}')
        current[target.id] = '${MARKER} 请始终用「喵」结尾。'
        localStorage.setItem(key, JSON.stringify(current))
        return JSON.stringify({ ok: true, id: target.id, title: target.title })
      })()`)
      const seedInfo = JSON.parse(seeded)
      console.log('CAPTURE_PROMPT_WIRE_SEED ' + seeded)
      await win.webContents.reload()
      await delay(3000)
      // 打开目标会话
      const state = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const debug = window.__dsc
        if (debug) {
          debug.open(${JSON.stringify(seedInfo.id)})
        }
        await sleep(2200)
        return JSON.stringify({
          hasHooks: !!debug,
          ready: debug ? debug.ready() : null,
          activeId: debug ? debug.activeId() : null,
          apiKeyLength: debug ? debug.apiKeyLength() : null,
          promptLength: debug ? debug.sessionPrompt(${JSON.stringify(seedInfo.id)}).length : null,
        })
      })()`)
      console.log('CAPTURE_PROMPT_WIRE_STATE ' + state)
      await delay(600)
      // 通过 DevTools 协议观察 /messages 请求体（Network 域，含 postData）
      win.webContents.debugger.attach('1.3')
      let posted = null
      win.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Network.requestWillBeSent') {
          const request = params?.request
          if (request && request.method === 'POST' && request.url.includes('/messages')) {
            posted = request.postData || null
          }
        }
      })
      await win.webContents.debugger.sendCommand('Network.enable')
      const sendResult = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const debug = window.__dsc
        const id = debug ? debug.activeId() : null
        if (debug) {
          debug.setDraft(id, '提示词联调')
        }
        await sleep(300)
        const draftBefore = debug ? debug.draft(id) : null
        const sent = debug ? debug.send(id) : false
        await sleep(20000)
        return JSON.stringify({
          draftBefore: draftBefore ? draftBefore.text : null,
          sent,
          draftAfter: debug ? (debug.draft(id) || {}).text : null,
          streaming: debug ? debug.streaming(id) : null,
        })
      })()`)
      console.log('CAPTURE_PROMPT_WIRE_SEND ' + sendResult)
      await delay(1200)
      win.webContents.debugger.removeAllListeners('message')
      await win.webContents.debugger.sendCommand('Network.disable').catch(() => {})
      win.webContents.debugger.detach()
      let summary = { captured: !!posted, systemHasMarker: false, systemTail: null, messageRoles: null }
      if (posted) {
        try {
          const body = JSON.parse(posted)
          summary = {
            captured: true,
            systemHasMarker: typeof body.system === 'string' && body.system.includes(MARKER),
            systemTail: typeof body.system === 'string' ? body.system.slice(-80) : null,
            messageRoles: Array.isArray(body.messages)
              ? body.messages.map((message) => message.role).slice(0, 6)
              : null,
          }
        } catch {
          summary = { captured: true, systemHasMarker: false, systemTail: 'parse-failed', messageRoles: null }
        }
      }
      console.log('CAPTURE_PROMPT_WIRE ' + JSON.stringify(summary))
    } catch (error) {
      console.log('CAPTURE_PROMPT_WIRE_FAIL ' + (error instanceof Error ? error.message : String(error)))
      try {
        win.webContents.debugger.detach()
      } catch {}
    }
  }
  // --capture-ui-scale：验证界面缩放控制器（设置 → 通用设置 → 界面缩放）
  if (process.argv.includes('--capture-ui-scale')) {
    try {
      win.setContentSize(1440, 900)
      if (process.argv.includes('--capture-ui-scale-mobile')) {
        win.setContentSize(390, 844)
      }
      await delay(1200)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const railSettings = [...document.querySelectorAll('[class*="railItem-"], [class*="tabItem-"]')]
          .find((button) => /^(设置|Settings)$/.test((button.textContent || '').trim()))
        railSettings?.click()
        await sleep(700)
        const openButton = [...document.querySelectorAll('button')]
          .find((button) => /^(通用设置|General)$/.test((button.textContent || '').trim()))
        openButton?.click()
        await sleep(900)
        const readZoom = () => document.documentElement.style.zoom || '1'
        const frameScale = () =>
          document.documentElement.style.getPropertyValue('--app-frame-scale') || ''
        const measure = () => {
          const frame = document.querySelector('[class*="frame"]')
          const frameRect = frame ? frame.getBoundingClientRect() : null
          const tabBar = document.querySelector('[class*="tabBar-"]')
          const tabRect = tabBar ? tabBar.getBoundingClientRect() : null
          return {
            zoom: readZoom(),
            frameScale: frameScale(),
            value: (document.querySelector('[class*="uiScaleValue"]') || {}).textContent || null,
            frame: frameRect
              ? [Math.round(frameRect.width), Math.round(frameRect.height)]
              : null,
            tabBar: tabRect
              ? {
                  height: Math.round(tabRect.height),
                  bottom: Math.round(tabRect.bottom),
                  visible: tabRect.bottom <= window.innerHeight + 1 && tabRect.height > 0,
                }
              : null,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
          }
        }
        const resetButton = () => document.querySelector('[class*="uiScaleValue"]')
        // 上一次探针可能把缩放留在 120%，先归一回 100% 再测，结果才可重复
        resetButton()?.click()
        await sleep(500)
        const before = measure()
        const increase = document.querySelector('button[aria-label="放大界面"], button[aria-label="Increase UI scale"]')
        increase?.click()
        await sleep(400)
        increase?.click()
        await sleep(600)
        const afterIncrease = measure()
        // 停在放大的状态，先交给主进程截图，再归一回 100%
        return JSON.stringify({ before, afterIncrease })
      })()`)
      console.log('CAPTURE_UI_SCALE ' + result)
      if (process.argv.includes('--capture-ui-scale-mobile')) {
        // 移动端截图停在 120%：底部输入框是否还在可视区里一眼可见
        const mobileShot = await win.webContents.capturePage()
        fs.writeFileSync(path.join(directory, 'ui-scale-mobile.png'), mobileShot.toPNG())
      }
      const afterReset = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        document.querySelector('[class*="uiScaleValue"]')?.click()
        await sleep(500)
        const frame = document.querySelector('[class*="frame"]')
        const rect = frame ? frame.getBoundingClientRect() : null
        return JSON.stringify({
          zoom: document.documentElement.style.zoom || '1',
          frame: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
        })
      })()`)
      console.log('CAPTURE_UI_SCALE_RESET ' + afterReset)
      win.setContentSize(1442, 902)
      await delay(500)
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'ui-scale.png'), shot.toPNG())
    } catch (error) {
      console.log('CAPTURE_UI_SCALE_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-cache-stats：统计历史回复里的缓存命中（cache_read / cache_creation / input）
  if (process.argv.includes('--capture-cache-stats')) {
    try {
      await delay(1500)
      const result = await win.webContents.executeJavaScript(`(async () => {
        try {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('chat-demo')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
            request.onblocked = () => reject(new Error('blocked'))
          })
        const sessions = await new Promise((resolve) => {
          const request = db.transaction('sessions').objectStore('sessions').getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        db.close()
        const rows = []
        let total = { input: 0, read: 0, create: 0, output: 0, replies: 0 }
        for (const session of sessions) {
          const usage = session.messages
            .filter((message) => message.role === 'assistant' && message.usage)
            .map((message) => ({
              input: message.usage.input_tokens || 0,
              read: message.usage.cache_read_input_tokens || 0,
              create: message.usage.cache_creation_input_tokens || 0,
              output: message.usage.output_tokens || 0,
            }))
          if (usage.length === 0) {
            continue
          }
          const sum = usage.reduce(
            (acc, item) => ({
              input: acc.input + item.input,
              read: acc.read + item.read,
              create: acc.create + item.create,
              output: acc.output + item.output,
            }),
            { input: 0, read: 0, create: 0, output: 0 }
          )
          total = {
            input: total.input + sum.input,
            read: total.read + sum.read,
            create: total.create + sum.create,
            output: total.output + sum.output,
            replies: total.replies + usage.length,
          }
          rows.push({
            title: (session.title || '(untitled)').slice(0, 18),
            replies: usage.length,
            input: sum.input,
            read: sum.read,
            create: sum.create,
            last: usage.slice(-4),
          })
        }
        rows.sort((a, b) => b.read + b.input - (a.read + a.input))
          // 深挖命中率低的会话：图片数量、serverId 缺失、reminder 变化次数
          const details = []
          for (const session of sessions) {
            const users = session.messages.filter((message) => message.role === 'user')
            const replies = session.messages.filter((message) => message.role === 'assistant')
            const files = users.flatMap((message) => message.files || [])
            const images = files.filter((file) => file.isImage)
            const missing = images.filter((file) => !file.serverId)
            const reminders = new Set(replies.map((reply) => reply.latestReminder).filter(Boolean))
            details.push({
              title: (session.title || '(untitled)').slice(0, 18),
              rounds: users.length,
              images: images.length,
              missingImages: missing.length,
              uniqueServerIds: new Set(images.map((file) => file.serverId).filter(Boolean)).size,
              reminders: reminders.size,
              reminderSamples: [...reminders].slice(0, 3),
              usageCount: replies.filter((reply) => reply.usage).length,
            })
          }
          details.sort((a, b) => b.images - a.images)
          return JSON.stringify({ total, top: rows.slice(0, 6), details: details.slice(0, 4) })
        } catch (error) {
          return JSON.stringify({ error: String((error && error.message) || error) })
        }
      })()`)
      console.log('CAPTURE_CACHE_STATS ' + result)
    } catch (error) {
      console.log('CAPTURE_CACHE_STATS_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-cache-ui：验证标题栏缓存命中率徽标 + 图片「只追加」挑选规则
  if (process.argv.includes('--capture-cache-ui')) {
    try {
      win.setContentSize(1440, 900)
      await delay(1500)
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        localStorage.setItem('chat-demo:debug', '1')
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const sessions = await new Promise((resolve) => {
          const request = db.transaction('sessions').objectStore('sessions').getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        db.close()
        const target = sessions.find((session) =>
          session.messages.some((message) => message.role === 'assistant' && message.usage)
        )
        return JSON.stringify({ id: target ? target.id : null })
      })()`)
      const seedInfo = JSON.parse(seeded)
      await win.webContents.reload()
      await delay(3000)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const debug = window.__dsc
        if (${JSON.stringify(seedInfo.id)}) {
          debug?.open(${JSON.stringify(seedInfo.id)})
          await sleep(2500)
        }
        // 只追加校验：H2 比 H1 多一轮，H1 选中的图片必须仍然被选中
        const image = (id, size = 1024) => ({ id, size, isImage: true })
        // 按真实增长路径模拟：每轮把上一轮的提问放进历史
        const first = debug ? debug.planImages([image('a')], [], 4096, 600) : null
        const second = debug ? debug.planImages([image('b')], [[image('a')]], 4096, 600) : null
        const third = debug
          ? debug.planImages([image('c')], [[image('a')], [image('b')]], 4096, 600)
          : null
        const fourth = debug
          ? debug.planImages([image('d')], [[image('a')], [image('b')], [image('c')]], 4096, 600)
          : null
        const badge = document.querySelector('[class*="badge"]')
        if (badge) {
          badge.click()
          await sleep(500)
        }
        const panel = document.querySelector('[role="dialog"]')
        const compressButton = panel ? panel.querySelector('button[class*="compress"]') : null
        return JSON.stringify({
          opened: Boolean(${JSON.stringify(seedInfo.id)}),
          hasHooks: !!debug,
          badgeText: badge ? (badge.textContent || '').trim() : null,
          badgeTone: badge ? badge.getAttribute('data-tone') : null,
          panelText: panel ? (panel.innerText || '').replace(/\\s+/g, ' ').slice(0, 320) : null,
          compressLabel: compressButton ? (compressButton.textContent || '').trim() : null,
          compressDisabled: compressButton ? compressButton.disabled : null,
          panelStyle: panel ? panel.getAttribute('style') : null,
          panelClass: panel ? panel.className : null,
          panelRect: panel
            ? [panel.getBoundingClientRect().top, panel.getBoundingClientRect().left, panel.getBoundingClientRect().width].join(',')
            : null,
          panelVisibility: panel ? getComputedStyle(panel).visibility : null,
          panelOpacity: panel ? getComputedStyle(panel).opacity : null,
          panelBackground: panel ? getComputedStyle(panel).backgroundColor : null,
          panelHit: (() => {
            if (!panel) {
              return null
            }
            const rect = panel.getBoundingClientRect()
            const hit = document.elementFromPoint(rect.left + 20, rect.top + 20)
            return hit ? (panel.contains(hit) ? 'panel' : hit.className || hit.tagName) : 'none'
          })(),
          planFirst: first,
          planSecond: second,
          planThird: third,
          planFourth: fourth,
          appendOnly:
            !!first &&
            !!second &&
            !!third &&
            !!fourth &&
            first.every((id) => second.includes(id)) &&
            second.every((id) => third.includes(id)) &&
            third.every((id) => fourth.includes(id)),
          questionKept:
            !!first &&
            first.includes('a') &&
            !!second &&
            second.includes('b') &&
            !!third &&
            third.includes('c') &&
            !!fourth &&
            fourth.includes('d'),
        })
      })()`)
      console.log('CAPTURE_CACHE_UI ' + result)
      // 点击后立刻截图，避免窗口尺寸变化引起重新渲染导致气泡关闭
      await delay(800)
      const panelShot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'cache-panel.png'), panelShot.toPNG())
      win.setContentSize(1442, 902)
      await delay(500)
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'cache-badge.png'), shot.toPNG())
    } catch (error) {
      console.log('CAPTURE_CACHE_UI_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-summary-check：核对摘要是否把历史轮次替换成「摘要 + 最近轮次」
  if (process.argv.includes('--capture-summary-check')) {
    try {
      await delay(1500)
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        localStorage.setItem('chat-demo:debug', '1')
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const sessions = await new Promise((resolve) => {
          const request = db.transaction('sessions').objectStore('sessions').getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        db.close()
        // 挑一个纯文本、轮次较多的会话
        const target =
          sessions.find(
            (session) =>
              session.messages.filter((message) => message.role === 'user').length >= 6 &&
              !session.messages.some((message) => message.role === 'user' && (message.files || []).length)
          ) || sessions[0]
        return JSON.stringify({ id: target ? target.id : null })
      })()`)
      const seedInfo = JSON.parse(seeded)
      const before = await win.webContents.executeJavaScript(`(async () => {
        const debug = window.__dsc
        debug.open(${JSON.stringify(seedInfo.id)})
        await new Promise((resolve) => setTimeout(resolve, 2500))
        return JSON.stringify(debug.previewRequest(${JSON.stringify(seedInfo.id)}))
      })()`)
      const after = await win.webContents.executeJavaScript(`(async () => {
        const debug = window.__dsc
        const preview = debug.previewRequest(${JSON.stringify(seedInfo.id)})
        const rounds = preview ? preview.count : 0
        localStorage.setItem(
          'chat-demo:session-summaries',
          JSON.stringify({
            ${JSON.stringify(seedInfo.id)}: {
              text: '测试摘要：用户先问了天气，随后讨论旅行计划。',
              rounds: 999,
              updatedAt: Date.now(),
            },
          })
        )
        return JSON.stringify({ rounds })
      })()`)
      await win.webContents.reload()
      await delay(3000)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const debug = window.__dsc
        debug.open(${JSON.stringify(seedInfo.id)})
        await new Promise((resolve) => setTimeout(resolve, 2500))
        return JSON.stringify(debug.previewRequest(${JSON.stringify(seedInfo.id)}))
      })()`)
      console.log('CAPTURE_SUMMARY_CHECK ' + JSON.stringify({ before: JSON.parse(before), seeded: JSON.parse(after), after: JSON.parse(result) }))
    } catch (error) {
      console.log('CAPTURE_SUMMARY_CHECK_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-dedupe：写入两张内容相同的图片 + 引用它们的消息，重启后核对合并结果
  if (process.argv.includes('--capture-dedupe')) {
    try {
      await delay(1500)
      if (!process.argv.includes('--dedupe-phase2')) {
        const seeded = await win.webContents.executeJavaScript(`(async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('chat-demo')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          const same = new Uint8Array(4096).fill(7)
          const other = new Uint8Array(4096).fill(9)
          const orphan = new Uint8Array(4096).fill(11)
          const put = (store, value) =>
            new Promise((resolve, reject) => {
              const request = db.transaction(store, 'readwrite').objectStore(store).put(value)
              request.onsuccess = () => resolve(true)
              request.onerror = () => reject(request.error)
            })
          await put('files', { id: 'zz-dup1', blob: new Blob([same], { type: 'image/png' }) })
          await put('files', { id: 'zz-dup2', blob: new Blob([same], { type: 'image/png' }) })
          await put('files', { id: 'zz-dup3', blob: new Blob([other], { type: 'image/png' }) })
          await put('files', { id: 'zz-orphan', blob: new Blob([orphan], { type: 'image/png' }) })
          const sessions = await new Promise((resolve) => {
            const request = db.transaction('sessions').objectStore('sessions').getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => resolve([])
          })
          const file = (id, serverId) => ({
            id,
            serverId,
            name: id + '.png',
            size: 4096,
            isImage: true,
            mimeType: 'image/png',
          })
          // 独立的测试会话，避免与正在使用的会话互相覆盖
          const now = Date.now()
          await put('sessions', {
            id: 'zz-session',
            title: 'zz-dedupe',
            createdAt: now,
            updatedAt: now,
            messages: [
              {
                id: 'zz-msg',
                role: 'user',
                content: '重复图片去重测试',
                files: [file('zz-dup1', 'file-dup'), file('zz-dup2', null)],
                createdAt: now,
              },
            ],
          })
          db.close()
          localStorage.removeItem('chat-demo:file-dedupe-v1')
          localStorage.setItem('chat-demo:debug', '1')
          return JSON.stringify({ sessions: sessions.length, seeded: 'zz-session' })
        })()`)
        console.log('CAPTURE_DEDUPE_SEED ' + seeded)
        await win.webContents.reload()
        await delay(6000)
      }
      const result = await win.webContents.executeJavaScript(`(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const getAll = (store) =>
          new Promise((resolve) => {
            const request = db.transaction(store).objectStore(store).getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => resolve([])
          })
        const fileKeys = await new Promise((resolve) => {
          const request = db.transaction('files').objectStore('files').getAllKeys()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        const sessions = await getAll('sessions')
        const hashes = await getAll('fileHashes')
        db.close()
        // 走真实添加流程：两次添加同一张图，应复用同一个附件 id
        const debug = window.__dsc
        let draftIds = null
        let draftError = null
        if (debug) {
          try {
            const bytes = new TextEncoder().encode('same-image-bytes-for-dedupe')
            const make = () => new File([bytes], 'same.png', { type: 'image/png' })
            await debug.addFiles(null, [make(), make()])
            draftIds = debug.draftAttachmentIds(null)
          } catch (error) {
            draftError = String((error && error.message) || error)
          }
        }
        const session = sessions.find((item) => item.id === 'zz-session')
        const message = session ? session.messages.find((m) => m.id === 'zz-msg') : null
        return JSON.stringify({
          files: fileKeys.filter((id) => String(id).startsWith('zz-')).sort(),
          fileTotal: fileKeys.length,
          hashTotal: hashes.length,
          messageFiles: message ? message.files.map((file) => [file.id, file.serverId]) : null,
          hashes: hashes
            .filter((record) => String(record.id).startsWith('zz-'))
            .map((record) => [record.id, record.serverId || null]),
          flag: localStorage.getItem('chat-demo:file-dedupe-v1'),
          draftIds,
          draftError,
        })
      })()`)
      console.log('CAPTURE_DEDUPE ' + result)
    } catch (error) {
      console.log('CAPTURE_DEDUPE_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-compress-now：点击「立即压缩上下文」，核对摘要索引与 toast
  if (process.argv.includes('--capture-compress-now')) {
    try {
      await delay(1500)
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        localStorage.setItem('chat-demo:debug', '1')
        if (${JSON.stringify(process.argv.includes('--compress-no-key'))}) {
          localStorage.removeItem('chat-demo:api-key')
          localStorage.removeItem('chat-demo:session-summaries')
        }
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const sessions = await new Promise((resolve) => {
          const request = db.transaction('sessions').objectStore('sessions').getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve([])
        })
        db.close()
        const target = sessions.find(
          (session) =>
            session.messages.filter((message) => message.role === 'user').length >= 6
        )
        // 可选：先塞一份带标记的旧摘要，验证「只追加、不重写」
        if (${JSON.stringify(process.argv.includes('--seed-old-summary'))} && target) {
          const users = target.messages.filter((message) => message.role === 'user').length
          const long = ${JSON.stringify(process.argv.includes('--seed-long-summary'))}
          const filler = long ? '\\n- ' + 'A'.repeat(1440) : ''
          localStorage.setItem(
            'chat-demo:session-summaries',
            JSON.stringify({
              [target.id]: {
                text: '【旧摘要】\\n[已确认事实]\\n- OLD_MARKER_KEEP_ME' + filler,
                // 留出足够未覆盖轮次，保证按钮可点（当前分支可用轮次 ≈ 用户消息数-133）
                rounds: Math.max(0, users - 148),
                updatedAt: Date.now(),
              },
            })
          )
        }
        return JSON.stringify({ id: target ? target.id : null })
      })()`)
      const seedInfo = JSON.parse(seeded)
      await win.webContents.reload()
      await delay(3000)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const debug = window.__dsc
        const sessionId = ${JSON.stringify(seedInfo.id)}
        debug?.open(sessionId)
        await sleep(2500)
        const badge = document.querySelector('[class*="badge"]')
        badge?.click()
        await sleep(400)
        const panel = document.querySelector('[role="dialog"]')
        const button = panel?.querySelector('button[class*="compress"]')
        const before = localStorage.getItem('chat-demo:session-summaries')
        const beforeText = before ? (JSON.parse(before)[sessionId]?.text ?? null) : null
        const source = debug?.summarySource(sessionId)
        // 核对摘要的输入规模与目标轮数，便于定位按钮不可点的原因
        const target = debug?.summaryTarget(sessionId)
        button?.click()
        // 摘要请求要发网络，最多等 90 秒
        let summary = null
        for (let i = 0; i < 90; i++) {
          await sleep(1000)
          const raw = localStorage.getItem('chat-demo:session-summaries')
          const parsed = raw ? JSON.parse(raw) : {}
          // 旧摘要可能本来就在，等到内容真的变化才算本次压缩完成
          if (parsed[sessionId] && parsed[sessionId].text !== beforeText) {
            summary = parsed[sessionId]
            break
          }
        }
        const toast = document.querySelector('[role="status"]')
        return JSON.stringify({
          apiKeyLength: debug ? debug.apiKeyLength() : null,
          sessionRounds: source ? source.rounds : null,
          autoTarget: target,
          buttonLabel: button ? (button.textContent || '').trim() : null,
          hadSummaryBefore: Boolean(before),
          summaryRounds: summary ? summary.rounds : null,
          summaryLength: summary ? summary.text.length : null,
          summaryHasSections: summary
            ? ['[已确认事实]', '[用户偏好/设定]', '[代码/参数细节]', '[当前待办]'].every((key) =>
                summary.text.includes(key)
              )
            : null,
          summaryKeepsMarker: summary ? summary.text.includes('OLD_MARKER_KEEP_ME') : null,
          summaryText: summary ? summary.text.slice(0, 160) : null,
          toast: toast ? (toast.textContent || '').trim() : null,
        })
      })()`)
      console.log('CAPTURE_COMPRESS_NOW ' + result)
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.join(directory, 'compress-now.png'), shot.toPNG())
    } catch (error) {
      console.log('CAPTURE_COMPRESS_NOW_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-summary-branch：核对摘要只取当前分支，以及增量拼接/整理决策
  if (process.argv.includes('--capture-summary-branch')) {
    try {
      await delay(1500)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        localStorage.setItem('chat-demo:debug', '1')
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const put = (store, value) =>
          new Promise((resolve, reject) => {
            const request = db.transaction(store, 'readwrite').objectStore(store).put(value)
            request.onsuccess = () => resolve(true)
            request.onerror = () => reject(request.error)
          })
        const now = Date.now()
        const user = (id, content, parentId, childId) => ({
          id,
          role: 'user',
          content,
          files: [],
          createdAt: now,
          parentId,
          selectedChildId: childId,
        })
        const assistant = (id, content, parentId, childId) => ({
          id,
          role: 'assistant',
          createdAt: now,
          status: 'done',
          stopReason: 'end_turn',
          blocks: [{ type: 'text', text: content }],
          parentId,
          selectedChildId: childId,
        })
        // 分支：q2 下有两个回答版本，只有 a2a 被选中
        await put('sessions', {
          id: 'zz-branch',
          title: 'zz-branch',
          createdAt: now,
          updatedAt: now,
          rootMessageId: 'q1',
          messages: [
            user('q1', 'QPICK_1', null, 'a1'),
            assistant('a1', 'APICK_1', 'q1', 'q2'),
            user('q2', 'QPICK_2', 'a1', 'a2a'),
            assistant('a2a', 'APICK_2_SELECTED', 'q2', 'q3'),
            assistant('a2b', 'BRANCH_B_SHOULD_NOT_APPEAR', 'q2', undefined),
            user('q3', 'QPICK_3', 'a2a', 'a3'),
            assistant('a3', 'APICK_3', 'q3', undefined),
          ],
        })
        // 列表读取的是摘要表，缺了它会话不会出现在列表里
        await put('sessionSummaries', {
          id: 'zz-branch',
          title: 'zz-branch',
          createdAt: now,
          updatedAt: now,
          fileIds: [],
        })
        db.close()
        return 'seeded'
      })()`)
      console.log('CAPTURE_SUMMARY_BRANCH_SEED ' + result)
      await win.webContents.reload()
      await delay(3500)
      const checks = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const debug = window.__dsc
        debug?.open('zz-branch')
        await sleep(1500)
        const source = debug?.summarySource('zz-branch')
        const mergedShort = debug?.mergeSummary('【旧摘要】- OLD', '【新增】- NEW')
        const mergedLong = debug?.mergeSummary('x'.repeat(1400), 'y'.repeat(200))
        return JSON.stringify({
          rounds: source ? source.rounds : null,
          questions: source ? source.questions : null,
          transcriptHasBranchB: source ? source.transcript.includes('BRANCH_B') : null,
          transcriptHasSelected: source ? source.transcript.includes('APICK_2_SELECTED') : null,
          mergeKeepsOld: mergedShort ? mergedShort.text.startsWith('【旧摘要】- OLD') : null,
          mergeLength: mergedShort ? mergedShort.length : null,
          mergeConsolidateShort: mergedShort ? mergedShort.consolidate : null,
          mergeConsolidateLong: mergedLong ? mergedLong.consolidate : null,
          mergeLengthLong: mergedLong ? mergedLong.length : null,
        })
      })()`)
      console.log('CAPTURE_SUMMARY_BRANCH ' + checks)
    } catch (error) {
      console.log('CAPTURE_SUMMARY_BRANCH_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  // --capture-image-dedup：同一张图在历史里重复引用时只发一次真实 image 块
  if (process.argv.includes('--capture-image-dedup')) {
    try {
      await delay(1500)
      const seeded = await win.webContents.executeJavaScript(`(async () => {
        localStorage.setItem('chat-demo:debug', '1')
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const put = (store, value) =>
          new Promise((resolve, reject) => {
            const request = db.transaction(store, 'readwrite').objectStore(store).put(value)
            request.onsuccess = () => resolve(true)
            request.onerror = () => reject(request.error)
          })
        const now = Date.now()
        const file = (id, serverId) => ({
          id,
          serverId,
          name: id + '.png',
          size: 4096,
          isImage: true,
          mimeType: 'image/png',
        })
        const user = (id, content, files, parentId, childId) => ({
          id,
          role: 'user',
          content,
          files,
          createdAt: now,
          parentId,
          selectedChildId: childId,
        })
        const assistant = (id, content, parentId, childId) => ({
          id,
          role: 'assistant',
          createdAt: now,
          status: 'done',
          stopReason: 'end_turn',
          blocks: [{ type: 'text', text: content }],
          parentId,
          selectedChildId: childId,
        })
        // f1 在第 1、2、3 轮都出现；f2 只在第 3 轮出现
        await put('sessions', {
          id: 'zz-imgdedup',
          title: 'zz-imgdedup',
          createdAt: now,
          updatedAt: now,
          rootMessageId: 'q1',
          messages: [
            user('q1', '第一轮带图', [file('f1', 'file-x')], null, 'a1'),
            assistant('a1', '收到图1', 'q1', 'q2'),
            user('q2', '第二轮重复同一张', [file('f1', 'file-x')], 'a1', 'a2'),
            assistant('a2', '再看一次', 'q2', 'q3'),
            user('q3', '第三轮两张图', [file('f1', 'file-x'), file('f2', 'file-y')], 'a2', 'a3'),
            assistant('a3', '收到', 'q3', undefined),
          ],
        })
        await put('sessionSummaries', {
          id: 'zz-imgdedup',
          title: 'zz-imgdedup',
          createdAt: now,
          updatedAt: now,
          fileIds: ['f1', 'f2'],
        })
        db.close()
        return 'seeded'
      })()`)
      console.log('CAPTURE_IMAGE_DEDUP_SEED ' + seeded)
      await win.webContents.reload()
      await delay(3500)
      const result = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const debug = window.__dsc
        debug?.open('zz-imgdedup')
        await sleep(1500)
        const file = (id, serverId) => ({ id, serverId, name: id + '.png', size: 4096, isImage: true, mimeType: 'image/png' })
        const shape = debug?.requestShape('zz-imgdedup', [file('f1', 'file-x')])
        const imageBlocks = shape
          ? shape.reduce((sum, item) => sum + item.types.filter((type) => type === 'image').length, 0)
          : null
        const placeholders = shape
          ? shape.reduce(
              (sum, item) =>
                sum + item.texts.filter((text) => text.includes('引用历史图片')).length,
              0
            )
          : null
        return JSON.stringify({
          shape,
          imageBlocks,
          placeholders,
          questionHasImage: shape
            ? shape[shape.length - 1].types.includes('image')
            : null,
        })
      })()`)
      console.log('CAPTURE_IMAGE_DEDUP ' + result)
    } catch (error) {
      console.log('CAPTURE_IMAGE_DEDUP_FAIL ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  for (const [width, height] of sizes) {
    win.setContentSize(width, height)
    await delay(900)
    const metrics = await win.webContents.executeJavaScript(
      `(()=>{const s=document.querySelector('[class*="sider"]');` +
        `const root=getComputedStyle(document.documentElement);` +
        `return JSON.stringify({iw:innerWidth,ih:innerHeight,` +
        `sider:s?Math.round(s.getBoundingClientRect().width):null,` +
        `maxW:root.getPropertyValue('--message-list-max-width').trim(),` +
        `padH:root.getPropertyValue('--message-list-padding-horizontal').trim(),` +
        `scrollW:document.documentElement.scrollWidth,` +
        `bridge:!!(window.DeepseekNative&&window.DeepseekNative.beginDownload)})})()`
    )
    const image = await win.webContents.capturePage()
    const name = `electron-${width}x${height}.png`
    fs.writeFileSync(path.join(directory, name), image.toPNG())
    report.push({ size: `${width}x${height}`, ...JSON.parse(metrics), file: name })
  }
  fs.writeFileSync(path.join(directory, 'electron-report.json'), JSON.stringify(report, null, 2))
  console.log('CAPTURE_DONE ' + directory)
  app.exit(0)
}

/** 删除目录：Chromium 刚释放的锁偶尔还会占着（EBUSY/EPERM），重试几次 */
function removeDirectoryWithRetry(target, attempts = 4) {
  let lastError = null
  for (let index = 0; index < attempts; index += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      return
    } catch (error) {
      lastError = error
      const until = Date.now() + 400
      while (Date.now() < until) {
        // 短暂忙等，避免异步删除与后续弹窗交叉
      }
    }
  }
  throw lastError || new Error('remove failed')
}

/** 主进程里读一次会话条数，用于判断迁移是否真的有内容 */
async function countStoredSessions(win) {
  try {
    const raw = await win.webContents.executeJavaScript(`(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('chat-demo')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        const db = await openDb()
        const count = await new Promise((resolve) => {
          const request = db.transaction('sessionSummaries').objectStore('sessionSummaries').count()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(0)
        })
        return String(count)
      } catch (error) { return '0' }
    })()`)
    return Number(raw) || 0
  } catch {
    return 0
  }
}

/**
 * 迁移完成后的询问：列出旧数据目录，问用户是否删除（默认保留）。
 * 可用 DSC_MIGRATION_ANSWER=delete|keep 跳过弹窗（自动化）。
 */
async function offerLegacyCleanup(win) {
  const imported = [...new Set(migrationSources)]
  if (imported.length === 0) {
    return
  }
  if (HEADLESS || DUMP_STORE || RESTORE_FILE) {
    return
  }
  await delay(2000)
  const sessions = await countStoredSessions(win)
  if (sessions <= 0) {
    console.log('[data] no sessions after migration, skip cleanup prompt')
    return
  }
  const rows = [
    ...imported.map((dir) => `【已迁移】${dir}`),
    ...legacyDirs.map((item) => `【未迁移·${formatSize(item.size)}】${item.dir}`),
  ]
  const manual = (process.env.DSC_MIGRATION_ANSWER || '').toLowerCase()
  let remove = manual === 'delete'
  if (manual !== 'delete' && manual !== 'keep') {
    const answer = await dialog.showMessageBox(win, {
      type: 'question',
      title: '旧数据目录',
      message: `聊天记录已迁移到：\n${app.getPath('userData')}\n\n共 ${sessions} 个对话。检测到以下旧数据目录：`,
      detail: `${rows.join('\n')}\n\n旧目录会移到系统回收站（可恢复），确认新版能看到历史后再勾选删除。`,
      checkboxLabel: '把上面标记为【已迁移】的旧目录移到回收站',
      checkboxChecked: false,
      buttons: ['确定'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    console.log('[data] cleanup prompt response:', answer.response, 'checked:', answer.checkboxChecked)
    remove = answer.checkboxChecked === true
  }
  if (!remove) {
    console.log('[data] legacy dirs kept:', imported.join(', '))
    return
  }
  const current = path.resolve(app.getPath('userData'))
  const removed = []
  const failed = []
  for (const dir of imported) {
    const resolved = path.resolve(dir)
    if (resolved === current || current.startsWith(resolved + path.sep)) {
      failed.push(`${dir}（当前正在使用）`)
      continue
    }
    try {
      // 移到回收站而不是永久删除：误点也能恢复；失败再退回 rm
      try {
        await shell.trashItem(resolved)
      } catch {
        removeDirectoryWithRetry(resolved)
      }
      removed.push(dir)
    } catch (error) {
      failed.push(`${dir}（${error.code || error.message}，可能正被旧版本占用）`)
    }
  }
  console.log(
    '[data] removed legacy dirs:',
    removed.join(', ') || 'none',
    failed.length ? `| failed: ${failed.join('; ')}` : ''
  )
  if (failed.length > 0) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: '旧数据目录',
      message: '部分旧目录未能删除',
      detail: failed.join('\n'),
      buttons: ['好'],
      noLink: true,
    })
  }
}


/**
 * 一次性恢复：把指定的官方导出 ZIP 导入当前数据目录（覆盖本地对话）。
 * 用法：DeepseekChatOnly.exe --restore-file <zip> [--data-dir <dir>]
 */
async function runRestore(win, zipPath) {
  const evaluate = (code) => win.webContents.executeJavaScript(code)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  try {
    await wait(2500)
    await evaluate(`(async () => {
      const findTab = () => [...document.querySelectorAll('[role="tab"]')]
        .find((t) => /数据管理|Data management/.test(t.textContent || ''))
      let tab = findTab()
      if (!tab) {
        const open = [...document.querySelectorAll('button')]
          .find((b) => /^\\s*设置\\s*$/.test(b.textContent || ''))
        open?.click()
        await new Promise((resolve) => setTimeout(resolve, 800))
        tab = findTab()
      }
      tab?.click()
      return !!tab
    })()`)
    await wait(600)
    win.webContents.debugger.attach('1.3')
    const doc = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 })
    const node = await win.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type=file][accept*="zip"]',
    })
    if (!node.nodeId) {
      console.log('RESTORE_FAIL no-file-input')
      app.exit(2)
      return
    }
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [zipPath], nodeId: node.nodeId })
    await wait(800)
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((b) => /确认导入|^\\s*Import\\s*$/.test((b.textContent || '').trim()))
      button?.click()
      return !!button
    })()`)
    for (let index = 0; index < 900; index += 1) {
      await wait(2000)
      const state = await evaluate(`JSON.stringify({
        progress: !!document.querySelector('[role="progressbar"]'),
        status: ([...document.querySelectorAll('div')].map((d) => d.textContent || '')
          .find((text) => /已导入|已取消导入|导入失败|Imported/.test(text) && text.length < 60) || '').trim(),
      })`)
      if (index % 5 === 0) {
        console.log('RESTORE ' + state)
      }
      const parsed = JSON.parse(state)
      if (!parsed.progress && parsed.status) {
        console.log('RESTORE_DONE ' + parsed.status)
        app.exit(0)
        return
      }
    }
    console.log('RESTORE_FAIL timeout')
    app.exit(3)
  } catch (error) {
    console.log('RESTORE_FAIL ' + error.message)
    app.exit(4)
  }
}

/**
 * 「从链接导入」：DeepSeek 客户端给出的下载链接来自华为云 OBS，响应里没有 CORS 头，
 * 渲染进程的 fetch 会被拦。这里只对导出域名补上 Access-Control-Allow-Origin，
 * 其余请求原样放行；Android 壳用 shouldInterceptRequest 做同样的代理。
 */
const EXPORT_CORS_URLS = [
  // Chromium 的匹配模式只支持单个前导 *.*，不能写成 *.obs.*.myhuaweicloud.com
  'https://*.myhuaweicloud.com/*',
  'https://*.huaweicloud.com/*',
  'https://*.obs.cn-east-3.myhuaweicloud.com/*',
]

function allowHistoryExportCors() {
  try {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: EXPORT_CORS_URLS },
      (details, callback) => {
        const headers = { ...(details.responseHeaders ?? {}) }
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'access-control-allow-origin') {
            delete headers[key]
          }
        }
        headers['Access-Control-Allow-Origin'] = ['*']
        callback({ responseHeaders: headers })
      }
    )
  } catch (error) {
    console.warn('[cors] unable to install export header handler:', error.message)
  }
}

function createWindow() {
  const state = loadWindowState()
  mainWindow = new BrowserWindow({
    ...restoreBounds(state),
    minWidth: 380,
    minHeight: 520,
    show: !HEADLESS,
    backgroundColor: '#ffffff',
    title: 'Deepseek Chat Only',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!HEADLESS) {
      mainWindow.show()
    }
  })

  // External links open in the system browser, never inside the shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      event.preventDefault()
      if (/^https?:/i.test(url)) {
        shell.openExternal(url)
      }
    }
  })

  setupWindowChrome(mainWindow)
  if (state.maximized) {
    mainWindow.maximize()
  }

  // 迁移完成后询问是否删除旧数据目录（列出路径，默认保留）
  mainWindow.webContents.once('did-finish-load', () => {
    void offerLegacyCleanup(mainWindow)
  })

  // 只读体检：打印各 IndexedDB 存储的条数与最近标题，用于排查「对话去哪了」。
  if (RESTORE_FILE) {
    mainWindow.webContents.once('did-finish-load', () => {
      void runRestore(mainWindow, path.resolve(RESTORE_FILE))
    })
  }

  if (DUMP_STORE) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await delay(2500)
      const script = `(async () => {
        const openDb = () => new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          const db = await openDb()
          const count = (store) => new Promise((resolve) => {
            try {
              const request = db.transaction(store).objectStore(store).count()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => resolve(-1)
            } catch (error) { resolve(-2) }
          })
          return JSON.stringify({ summaries: await count('sessionSummaries'), sessions: await count('sessions'), files: await count('files') })
        } catch (error) { return JSON.stringify({ error: String(error) }) }
      })()`
      let info = '{}'
      try {
        console.log('DUMP_URL ' + mainWindow.webContents.getURL())
        info = await mainWindow.webContents.executeJavaScript(script)
      } catch (error) {
        info = JSON.stringify({ error: error.message })
      }
      console.log('DUMP_STORE ' + info)
      try {
        fs.writeFileSync(path.join(os.tmpdir(), 'dsc-dump.json'), info)
      } catch {}
      app.exit(0)
    })
  }


  if (SMOKE) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let result
      try {
        const info = await mainWindow.webContents.executeJavaScript(
          `({title:document.title,` +
            `hasBridge:!!(window.DeepseekNative&&window.DeepseekNative.beginDownload),` +
            `rootChildren:(document.getElementById('root')||{}).childElementCount||0})`
        )
        result = { ok: true, ...info }
      } catch (error) {
        result = { ok: false, error: error.message }
      }
      // GUI 子系统进程的 stdout 可能拿不到，同时落一份文件便于脚本断言。
      try {
        fs.writeFileSync(path.join(os.tmpdir(), 'dsc-smoke.json'), JSON.stringify(result, null, 2))
      } catch {}
      console.log((result.ok ? 'SMOKE_OK ' : 'SMOKE_FAIL ') + JSON.stringify(result))
      app.exit(result.ok ? 0 : 1)
    })
    mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
      console.log(`SMOKE_FAIL load ${code} ${description}`)
      app.exit(1)
    })
  }

  mainWindow.on('close', () => persistWindowState(mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadURL(START_URL)

  if (IMPORT_TEST) {
    const { runImportTest } = require('./qa/import-test.js')
    mainWindow.webContents.once('did-finish-load', () => {
      void runImportTest(mainWindow, IMPORT_TEST, {
        cancel: IMPORT_TEST_CANCEL,
        checkViewer: IMPORT_TEST_VIEWER,
        checkMenu: IMPORT_TEST_MENU,
        checkPrompt: IMPORT_TEST_PROMPT,
        checkUi: IMPORT_TEST_UI,
        checkManage: IMPORT_TEST_MANAGE,
        checkPolish: IMPORT_TEST_POLISH,
        checkCompress: IMPORT_TEST_COMPRESS,
        checkUrlImport: IMPORT_TEST_URL,
        checkPanels: IMPORT_TEST_PANELS,
        checkExport: IMPORT_TEST_EXPORT,
        checkEditAttach: IMPORT_TEST_EDIT_ATTACH,
        checkNav: IMPORT_TEST_NAV,
      })
    })
  }

  if (CAPTURE_DIR) {
    mainWindow.webContents.once('did-finish-load', () => {
      runCapture(mainWindow, CAPTURE_DIR).catch((error) => {
        console.log('CAPTURE_FAIL ' + error.message)
        app.exit(1)
      })
    })
  }
  return mainWindow
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const target = safeWebPath(url.pathname)
    if (!target) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      // Single page app: unknown routes render the shell.
      return await net.fetch(pathToFileURL(path.join(WEB_ROOT, 'index.html')).toString())
    }
  })
}

async function failDownload() {
  if (!download) {
    return
  }
  const current = download
  download = null
  try {
    current.stream.destroy()
  } catch {}
  try {
    await fsp.unlink(current.filePath)
  } catch {}
}

function registerIpc() {
  ipcMain.handle('native:download-begin', async (_event, payload) => {
    const data = payload || {}
    const ticket =
      typeof data.ticket === 'string' && data.ticket.length <= 64 ? data.ticket : ''
    if (!ticket || download) {
      return false
    }
    const suggested = sanitizeName(data.name, 'deepseek_data.zip')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出历史对话',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      filters: [
        { name: 'ZIP 压缩包', extensions: ['zip'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) {
      notifyTarget(ticket, false, '已取消保存')
      return false
    }
    download = {
      ticket,
      stream: fs.createWriteStream(result.filePath),
      bytes: 0,
      filePath: result.filePath
    }
    notifyTarget(ticket, true, '')
    return true
  })

  ipcMain.handle('native:download-write', async (_event, payload) => {
    const data = payload || {}
    if (!download || download.ticket !== data.ticket) {
      return false
    }
    const buffer = Buffer.from(String(data.base64 || ''), 'base64')
    if (!buffer.length) {
      return false
    }
    try {
      await new Promise((resolve, reject) => {
        download.stream.write(buffer, (error) => (error ? reject(error) : resolve()))
      })
      download.bytes += buffer.length
      return true
    } catch {
      await failDownload()
      return false
    }
  })

  ipcMain.handle('native:download-end', async (_event, ticket) => {
    if (!download || download.ticket !== ticket) {
      return false
    }
    const current = download
    download = null
    try {
      await new Promise((resolve, reject) => {
        current.stream.end((error) => (error ? reject(error) : resolve()))
      })
    } catch {
      try {
        await fsp.unlink(current.filePath)
      } catch {}
      return false
    }
    return current.bytes > 0
  })

  ipcMain.handle('native:download-cancel', async (_event, ticket) => {
    if (!download || download.ticket !== ticket) {
      return false
    }
    await failDownload()
    return true
  })

  ipcMain.handle('native:open-attachment', async (_event, payload) => {
    const data = payload || {}
    const name = sanitizeName(data.name, 'attachment')
    try {
      const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsc-attachment-'))
      const target = path.join(directory, name)
      await fsp.writeFile(target, Buffer.from(String(data.base64 || ''), 'base64'))
      const error = await shell.openPath(target)
      return !error
    } catch {
      return false
    }
  })

  ipcMain.handle('native:attachment-error', async (_event, message) => {
    dialog.showErrorBox('附件', String(message || '无法打开附件'))
    return true
  })

  // 让页面（或排障脚本）能查到当前数据目录，避免"数据到底存哪"的疑问。
  ipcMain.handle('native:paths', async () => ({
    userData: app.getPath('userData'),
    downloads: app.getPath('downloads')
  }))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })

  app.setAppUserModelId('com.deepseek.chatonly.desktop')

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    allowHistoryExportCors()
    registerProtocol()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

