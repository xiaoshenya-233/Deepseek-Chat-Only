# Android（WebView 壳）

把 `release/web/` 的静态站点打包成一个可直接安装的 APK。外壳是零第三方依赖的原生 `WebView`，
不使用 Gradle / AndroidX / Capacitor，构建链只有 `aapt2 → javac → d8 → zipalign → apksigner`。

## 产物

```text
release/android/Deepseek Chat Only.apk
```

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| JDK 17+ | `javac`、`keytool` |
| Android SDK build-tools + platform | 解压到仓库根的 `.apkbuild/bt/android-15`、`.apkbuild/pf/android-35` |
| Python 3 + Pillow | 仅重新生成启动图标时需要（`tools/make_icon.py`） |

## 构建

```powershell
# 先构建网页（产物在 release\web），再打 APK
powershell -NoProfile -ExecutionPolicy Bypass -File web\build-windows.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File android\build-apk.ps1
```

可选参数：

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `-BuildTools <dir>` | `.apkbuild\bt\android-15` | build-tools 目录（aapt2 / zipalign / apksigner） |
| `-PlatformJar <jar>` | `.apkbuild\pf\android-35\android.jar` | 编译与链接用的 `android.jar` |
| `-OutDir <dir>` | `release\android` | APK 输出目录 |
| `-Python <exe>` | `python` | 图标生成用的解释器 |
| `-SkipIcon` | 关闭 | 跳过图标重新生成，复用 `res/mipmap-*` 里已有的图标 |

脚本做的事：同步 `release/web` 的网页资源 → 编译资源 → 链接 APK → 编译 Java → dex →
追加 `classes.dex` → 归一化条目（保持 `resources.arsc` 不压缩）→ 4 KB / 16 KB 对齐 →
签名（v1 + v2 + v3，首次自动生成 `debug.keystore`）→ 校验签名。

## 网页资源与安全源

- 网页资源随 APK 打包在 `assets/www/`（`index.html` + `static/` + 根目录的 `logo.png`）；
- 页面通过 `https://appassets.local/` 加载，`WebViewClient.shouldInterceptRequest` 把这些请求映射到
  APK 内的 assets，因此页面拥有真正的安全源（`localStorage`、`IndexedDB`、CORS 行为与桌面浏览器一致）；
- 未知路径回退到 `index.html`，外部链接交给系统浏览器；
- 支持网页里的文件选择（拍照 / 相册 / 文件三类入口）、返回键优先在网页内后退。

## 安装

```powershell
adb install -r "release\android\Deepseek Chat Only.apk"
```

或把 APK 拷到手机点击安装（需在系统设置里允许安装未知来源应用）。
若提示「不兼容」，用 `adb install` 能看到具体错误码（如 `INSTALL_FAILED_NO_MATCHING_ABIS`）。

## 应用信息

| 项 | 值 |
| --- | --- |
| 包名 | `com.deepseek.apidemo`（改包名 = 新应用，旧数据不迁移） |
| 版本号 | 来自仓库根 `VERSION`：`versionName` 用原文，`versionCode` 用派生整数 |
| minSdk / targetSdk | 24 / 35 |
| 签名 | 默认 `debug.keystore`，适合自用与内测；正式分发请换自己的密钥 |

`AndroidManifest.xml` 里的 `versionCode` / `versionName` 只是占位，由 `build-apk.ps1` 用 aapt2 参数覆盖；
网页资源的版本号来自 `release/web/index.html` 的 `application-version`。

## 目录

```text
android/
├─ src/com/deepseek/apidemo/MainActivity.java   WebView 宿主、下载桥、附件选择、返回键
├─ res/                                        图标、颜色、字符串
├─ AndroidManifest.xml
├─ build-apk.ps1                               构建入口
├─ tools/                                      图标生成、ZIP 条目追加、APK 归一化
└─ assets/www/                                 构建时同步的网页资源（生成物，不入库）
```

## 许可

- 本仓库整体以 **GNU GPL v3.0** 发布，全文见仓库根 `LICENSE`；
- APK 的 `assets/www/` 里同时带上 `LICENSE`、`NOTICE` 与 `LICENSES/MIT-deepseek-chat-demo.txt`；
- 网页部分派生自 `deepseek-ai/chat-demo`（MIT，版权归 DeepSeek），该声明是 MIT 许可的要求，
  随 APK 再分发时不得删除或改写。
