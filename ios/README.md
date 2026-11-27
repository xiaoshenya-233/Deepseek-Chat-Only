# iOS（WKWebView 壳）

与 Android 壳同源：把 `release/web/` 的静态站点打进 App，首次启动从本地加载，不依赖在线页面。
外壳由 SwiftUI + `WKWebView` + 本地 HTTP 服务组成，网页通过 `WKScriptMessageHandler` 调用原生能力。

## 产物

```text
release/ios/DeepseekChatOnly-<version>-unsigned.ipa
```

`.ipa` 只能在 macOS + Xcode 15 及以上编译；Windows / Linux 只能准备资源。

## 构建

### 1. 准备网页资源（任何系统）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web\build-windows.ps1   # 发布到 release\web
powershell -NoProfile -ExecutionPolicy Bypass -File ios\stage-web.ps1       # 同步到 ios\DeepseekChatOnly\www
```

`stage-web.ps1` 与 `android/build-apk.ps1` 取的是同一份 `release/web/` 产物，外加仓库根的源码资产 `logo.png`，
因此 APK 与 IPA 的网页内容一定一致。`ios/DeepseekChatOnly/www` 是生成物，已加入 `.gitignore`。

### 2. 编译 IPA（macOS）

```bash
./ios/build-ipa.sh              # 全量：网页 → www → xcodebuild → 打包
./ios/build-ipa.sh --skip-web   # 网页产物已是最新时跳过前两步
```

脚本以 `CODE_SIGNING_ALLOWED=NO` 构建未签名包，把 `DeepseekChatOnly.app` 放进 `Payload/` 打成 zip，
输出到 `release/ios/`。版本号来自仓库根 `VERSION`：`MARKETING_VERSION` 用原文，
`CURRENT_PROJECT_VERSION` 用派生整数（`0.130.02` → `130002`）。
`project.pbxproj` 里的 `MARKETING_VERSION = 0.0.0` / `CURRENT_PROJECT_VERSION = 1` 只是占位，构建时被覆盖。

### 3. 没有 Mac 时

`.github/workflows/ios-ipa.yml` 会在 `macos-14` runner 上跑同一套脚本，把未签名 IPA 作为 artifact 上传。

## 安装

未签名 IPA 不能直接安装，需要重签名：

- **Sideloadly / AltStore**：Windows 或 macOS 上用自己的 Apple ID 重签名后装进设备；
- **自己的开发者证书**：`codesign` + `xcodebuild -exportArchive` 重新导出。

## 应用信息

| 项 | 值 |
| --- | --- |
| Bundle ID | `com.deepseek.chatonly`（需替换为自己的开发者账号下的 ID） |
| 版本号 | 来自仓库根 `VERSION`（见上） |
| 最低系统 | iOS 15+ |
| 数据位置 | App 容器内 `Library/WebKit/`；导出文件在「文件」App 的 Deepseek Chat Only 目录 |

## 目录

```text
ios/
├─ DeepseekChatOnly/
│  ├─ App.swift              SwiftUI 入口
│  ├─ WebViewController.swift WKWebView 宿主、下载桥、附件打开
│  ├─ LocalServer.swift       本地 HTTP 服务（给 WKWebView 提供安全源）
│  ├─ Bridge.swift            注入的 Promise shim 与消息处理
│  ├─ Info.plist / Assets.xcassets
│  └─ www/                    构建时同步的网页资源（生成物，不入库）
├─ DeepseekChatOnly.xcodeproj
├─ stage-web.ps1              同步网页资源
└─ build-ipa.sh               macOS 构建未签名 IPA
```

## 许可

- 本仓库整体以 **GNU GPL v3.0** 发布，全文见仓库根 `LICENSE`；
- `ios/DeepseekChatOnly/www/` 里同时带上 `LICENSE`、`NOTICE` 与 `LICENSES/MIT-deepseek-chat-demo.txt`，
  打包后位于 App 的资源目录中；
- 网页部分派生自 `deepseek-ai/chat-demo`（MIT，版权归 DeepSeek），该声明随 IPA 再分发时不得删除或改写。
