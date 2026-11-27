# 桌面端（Electron）

与 Android / iOS 壳共用同一份网页产物和同一个 `window.DeepseekNative` 契约，页面侧不需要平台判断。

## 结构

```text
desktop/
├─ main.js             主进程：app:// 自定义协议、窗口状态、数据目录、IPC、下载与附件
├─ preload.js          contextBridge 暴露 window.DeepseekNative
├─ prepare-web.ps1     把网页产物复制到 desktop\web（优先 ..\web\dist，缺失时回退 ..\release\web）
├─ build-versioned.mjs 用仓库根 VERSION 调 electron-builder，输出目录固定为 ..\release\desktop
├─ build-win.ps1       Windows 一键打包（镜像 + 清理中间产物）
├─ build-deb.sh        Debian / Ubuntu 打包（在 WSL 或 Linux 里运行）
├─ nsis/hooks.nsh      安装/卸载时保留 data\ 的钩子
├─ qa/                 本机自动化检查脚本（仅开发用）
└─ package.json        electron + electron-builder 配置
```

## 为什么用 `app://` 而不是 `file://`

`file://` 页面的源是「不透明源」，`IndexedDB` / `localStorage` 行为不可靠。主进程注册了标准且安全的
`app://bundle/`（等价于 Android 的 `https://appassets.local/`），因此本地数据、CORS 与浏览器一致。
外部链接走系统浏览器，`blob:` 附件由 IPC 交给系统默认应用打开。

## 开发运行

```powershell
cd desktop
npm install      # 首次：下载 Electron（约 100 MB+）
npm start        # 运行（会先同步网页产物）
npm run start:dev # 同上，并允许 F12 打开开发者工具
npm run smoke     # 无窗口自检：加载页面、检查桥接、打印结果后退出
npm run capture   # 多种窗口宽度截图到 ..\docs\screenshots
```

网页资源不是软链接：`prepare-web.ps1` 每次把最新产物**复制**到 `desktop\web`。

## 打包

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build-win.ps1
```

- 目标：NSIS 安装包、portable 单文件、免安装 zip（x64）；
- 产物统一输出到 `release\desktop\`，脚本结束会清掉 `win-unpacked`、`.icon-ico`、`*.nsis.7z` 等中间物；
- 默认走国内镜像（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`）；
  若网络必须经过 TLS 代理，用 `-CaFile <代理根证书>` 传入额外 CA；
- 没有代码签名证书时自动跳过签名（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。

### Debian / Ubuntu

```bash
wsl -d Debian -- bash /mnt/e/Project/Deepseek-Chat-Only/desktop/build-deb.sh
```

- 可分段执行：`STEP=prep` / `STEP=build` / `STEP=verify`（不传则三步都跑）；
- Electron 运行时优先取 `desktop/.cache/electron-<ver>-linux-x64.zip`，没有再联网下载；
- 产物：`release/desktop/deepseek-chat-only_<version>_amd64.deb`，安装后命令为 `deepseek-chat-only`，
  文件位于 `/opt/deepseek-chat-only/`。

### 产物一览

```text
release/desktop/
├─ Deepseek-Chat-Only-<version>-x64-setup.exe   安装向导（可选安装目录）
├─ Deepseek Chat Only <version>.exe             免安装单文件
├─ Deepseek Chat Only-<version>-win.zip         解压即用
├─ Deepseek-Chat-Only-<version>-x64-setup.exe.blockmap   差分更新用
└─ deepseek-chat-only_<version>_amd64.deb
```

版本号来自仓库根 `VERSION`：`directories.output` 与 `extraMetadata.version` 都由 `build-versioned.mjs` 注入，
`package.json` 里的 `0.0.0` 只是占位。

## 安装位置与数据

- **安装向导**按用户安装（`perMachine: false`），默认 `%LOCALAPPDATA%\Programs\Deepseek Chat Only`，不需要 UAC；
  安装位置可自选，聊天数据写在安装目录下的 `data\`；
- 装到不可写目录（如 `C:\Program Files`）时，数据回退到 `%LOCALAPPDATA%\DeepseekChatOnly\`；
- **免安装**：zip 解压或 portable 直接运行，数据在 `<exe 目录>\data\`（portable 跟随 `PORTABLE_EXECUTABLE_DIR`）；
- **旧目录迁移**：首次启动若当前 `data\` 为空，会从 `%LOCALAPPDATA%\DeepseekChatOnly`、上次记录的数据目录、
  `%APPDATA%\DeepseekChatOnly` 以及更早的目录名**复制**一次（源目录保留），随后弹窗询问是否把旧目录移入回收站；
- **覆盖安装**：安装器的 `customRemoveFiles` 钩子只清理应用文件，`data\` 原样保留；
- **卸载**：先把 `data\` 复制到 `%APPDATA%\DeepseekChatOnly`（只复制不移动），重装后首次启动再迁回；
- 实际路径可从桥接的 `getPaths()` 或启动日志 `[data] data directory: ...` 查看。

## 调试参数

| 参数 | 用途 |
| --- | --- |
| `--dev` | 允许 F12 打开开发者工具 |
| `--data-dir <dir>` | 指定数据目录（QA / 多开），不写入位置记录 |
| `--smoke` | 无窗口自检：检查桥接与 DOM 后退出 |
| `--capture <dir>` | 多种窗口宽度截图 + `electron-report.json` |
| `--dump-store` | 只读打印本地 `{summaries, sessions, files}` |
| `--restore-file <zip>` | 从 DeepSeek 官方导出格式恢复 |
| `--import-test <zip>` | 自动走一遍「设置 → 数据管理 → 导入」，用于回归检查 |

`qa/` 下的脚本配合 `--import-test` 使用，样例归档在 `qa/fixtures/`；这些开关只在开发时使用，不影响正常启动流程。

## 已知限制

- 安装包未签名：首次运行会出现 SmartScreen 提示；企业环境下如需静默分发请自行签名。
- 某些安全软件会限制从特定目录（例如开发目录）启动的可执行文件；把安装包放到普通目录（`D:\Apps`）即可。
- Linux 只提供 deb（AppImage 需要额外的运行时依赖，未在发布流程中启用）。

## 许可

- 本仓库整体以 **GNU GPL v3.0** 发布，全文见仓库根 `LICENSE`；
- Windows 安装目录下的 `licenses\` 文件夹、以及 `resources\app\web\`，都包含
  `LICENSE`（GPLv3）、`NOTICE` 与 `LICENSES\MIT-deepseek-chat-demo.txt`；
  deb 版对应 `/opt/deepseek-chat-only/LICENSE.txt`、`NOTICE.txt`、`LICENSES/`；
- 网页部分派生自 `deepseek-ai/chat-demo`（MIT，版权归 DeepSeek）。MIT 要求再分发时保留其版权与
  许可声明，因此这些文件不要从安装包里删除。
