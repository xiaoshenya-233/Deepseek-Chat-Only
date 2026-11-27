# Deepseek Chat Only

把 DeepSeek 的网页聊天装进电脑和手机，**聊天记录、图片、API Key 都只存在你自己的设备里**。

- 左侧是会话列表，右侧是聊天区，输入框固定在底部；
- 也可以切成「休闲模式」——左边一列功能图标、中间会话列表、右边聊天的三栏布局，更像常见的聊天软件。

> 这是第三方作品，基于开源项目 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 修改而来，
> **不是 DeepSeek 官方产品**，与官方没有隶属关系，也没有官方支持。

## 你可以用它做什么

**聊天**

- 和网页版一样对话：流式输出、停止、重新回答、继续回答
- 展开看模型的思考过程；需要安静时可以在设置里把它一键折叠
- 联网搜索、引用来源、上传图片和文件（电脑上可以拖进来或直接粘贴）
- 编辑已经发出去的消息、在多个回答版本之间来回切换
- 朗读回答；Markdown、代码块、数学公式、流程图都能正常显示，图还能放大存成图片

**长对话**

- 聊得很长时，程序会自动把很早的内容压成一段提要，只把「提要 + 最近几轮」发出去，既省额度也不容易忘事
- 顶部会显示「缓存命中率」，点一下能看到这轮实际用了多少 token；需要时也可以手动「立即压缩上下文」

**管理自己的数据**

- 导入 / 导出 DeepSeek 官方格式的历史对话压缩包
- 可以只导出选中的几个对话，也可以批量删除
- 同一张图片只存一份；会话可以设头像，表情包也能自己上传

**顺手的小功能**

- 会话提示词：给某个对话单独定人设，比如「你是一位严谨的电路设计顾问」
- 会话总览：点标题栏的列表图标，能列出这个对话里问过的每一个问题，点一下就跳过去
- 回到底部：往上翻看旧消息时，输入框上方会出现一个向下的按钮，点一下回到最新
- 界面缩放 80%–150%；主题可选浅色 / 深色 / 跟随系统 / 日出日落自动切换
- 效率模式 / 休闲模式一键切换，聊天数据完全共用

## 装到电脑上（Windows）

在 `release发行页` 里挑一个：

| 文件 | 适合谁 |
| --- | --- |
| `Deepseek-Chat-Only-<版本>-x64-setup.exe` | 想装进开始菜单、桌面有快捷方式（安装时可以自己选目录） |
| `Deepseek Chat Only-<版本>-win.zip` | 不想安装，解压到任意文件夹双击就能用 |

- 安装不需要管理员权限，默认装在当前用户目录；
- 程序没有购买代码签名，第一次运行 Windows 会拦一下：点「更多信息」→「仍要运行」；
- 如果你把它装进 `C:\Program Files` 这类不能写入的目录，聊天数据会自动改存到用户目录，不影响使用。

**第一次打开**：点左下角「设置」→「数据管理」→ 填入自己的 API Key
（在 [platform.deepseek.com](https://platform.deepseek.com) 申请）。填完就能开始聊天。

## 装到手机上（Android）

把 `release/android/Deepseek Chat Only.apk` 传到手机安装。系统会提示「未知来源应用」，
在设置里允许一次即可。也可以用数据线：

```bash
adb install -r "Deepseek Chat Only.apk"
```

手机上支持：拍照 / 相册 / 文件三种发送入口、返回键先退弹窗再退页面、侧滑打开会话列表。

## 装在 Linux 上（Ubuntu / Debian）

```bash
sudo apt install ./deepseek-chat-only_<你下载的版本>_amd64.deb
```

装好后在应用菜单里能找到「Deepseek Chat Only」，命令是 `deepseek-chat-only`。

## 想在浏览器里用

把 `release/web/` 整个文件夹放到任意静态网站空间（nginx、对象存储、GitHub Pages 都行），
打开首页就是完整的聊天界面。注意纯浏览器没有「保存到本地文件」的原生能力，
导出时会走浏览器下载，附件会用新标签页打开。

## 我的数据存在哪

| 你用的版本 | 聊天数据位置 |
| --- | --- |
| Windows 安装版 | 安装目录里的 `data` 文件夹 |
| Linux | `/opt/deepseek-chat-only/data` |
| Android / iOS | 应用自己的私有空间（系统文件管理器里看不到，属于正常） |

- 想整体搬走：把 `data` 文件夹一起复制过去就行（安装版直接把整个安装目录拷走也可以）；
- 覆盖安装、升级版本都不会动 `data`；卸载时会先把 `data` 备份到 `%APPDATA%\DeepseekChatOnly`，重装后自动找回来；
- 以前装在别处、现在换了新目录时，程序会在第一次启动自动把旧数据**复制**过来（旧的不会删），
  然后问你要不要清理旧目录。

## 常见问题

**第一次运行被 Windows 拦住了？**
程序没有代码签名，属于正常现象。点「更多信息 → 仍要运行」即可；也可以用 zip / 单文件版本。

**没有 API Key 能干什么？**
能看、能搜、能导入导出已有的聊天记录和附件；发消息、压缩上下文这类要调用 DeepSeek 接口的功能需要 Key。

**断网还能用吗？**
聊天需要联网。桌面和手机版本把界面打包在本地，所以打开很快，也能随时翻看历史，但发消息必须联网。

**我的聊天会被上传吗？**
不会上传到本项目。只有你自己发出去的那条消息、附件和参数会送到 DeepSeek 的接口；
配置、历史、图片都保存在本机，项目不带任何统计上报。

**能同时开两个窗口 / 用两个数据目录吗？**
可以，桌面版支持 `--data-dir <目录>` 指定另一个数据目录（适合测试或分开工作与个人数据）。

## 自己编译

只有想改代码时才需要这一步。依次执行：

```powershell
# 1. 网页（需要 Node 22+ 和 pnpm）
powershell -NoProfile -ExecutionPolicy Bypass -File web\build-windows.ps1

# 2. Android（需要 JDK 17+ 和 Android SDK，解压在 .apkbuild\）
powershell -NoProfile -ExecutionPolicy Bypass -File android\build-apk.ps1

# 3. Windows 桌面（第一次会自动下载打包工具）
cd desktop
npm install
npm run dist:win
```

Linux 安装包在 WSL 里执行 `desktop/build-deb.sh`，iOS 安装包在 macOS 上执行 `ios/build-ipa.sh`。
所有产物都会出现在仓库根的 `release/` 目录里。目录结构、模块划分与版本号规则见
[`CODE_ARCHITECTURE.md`](./CODE_ARCHITECTURE.md)。

## 关于本项目

- **来源**：网页部分派生自 `deepseek-ai/chat-demo`（MIT，版权归 DeepSeek），锁定的上游版本见 `web/package.json`；
  本仓库在自己的源码里补齐了上面列出的功能，相对上游的改动快照在 `docs/patches/local-web.patch`。
- **许可**：本项目整体以 **GNU GPL v3.0** 发布（全文见 [`LICENSE`](./LICENSE)）——
  可以自由使用、修改、再分发，但再分发时必须以同样的许可公开源代码并保留声明。
- **上游声明必须保留**：`web/` 中来自 chat-demo 的部分仍是 MIT，其版权与许可声明单独保存在
  [`LICENSES/MIT-deepseek-chat-demo.txt`](./LICENSES/MIT-deepseek-chat-demo.txt)，
  并随每个安装包 / APK / 站点一起分发；这部分声明不能删除或替换。
- **第三方与商标**：React、Mermaid、KaTeX、Electron 等依赖遵循各自许可证；
  本项目不是 DeepSeek 官方产品，请勿用其名称或 Logo 暗示官方关系，图标若涉及他人商标请自行替换。
  完整的许可与来源说明见 [`NOTICE`](./NOTICE)。
