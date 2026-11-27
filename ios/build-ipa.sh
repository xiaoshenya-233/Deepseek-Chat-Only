#!/usr/bin/env bash
#
# 在 macOS + Xcode 15 及以上构建未签名的 DeepseekChatOnly.ipa。
#
#   ./ios/build-ipa.sh              # 全量：构建网页产物 → 同步 → xcodebuild → 打包 IPA
#   ./ios/build-ipa.sh --skip-web   # 跳过网页构建（www 已经是最新的）
#
# 产物：release/ios/DeepseekChatOnly-<version>-unsigned.ipa
# （所有成品统一在仓库根的 release/ 下：web / android / desktop / ios）
#
# 说明：Windows / Linux 上没有 iOS SDK，只能生成工程与资源（ios/stage-web.ps1），
# 真正的 .ipa 必须在 macOS 上编译；未签名 IPA 可以用 Sideloadly / AltStore 在
# Windows 上重签名后安装到自己的设备。
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$IOS_DIR/.." && pwd)"
BUILD_DIR="$IOS_DIR/build"
DIST_DIR="$ROOT/release/ios"
SKIP_WEB=0

for arg in "$@"; do
    case "$arg" in
        --skip-web) SKIP_WEB=1 ;;
        -h|--help)
            sed -n '2,14p' "$0"
            exit 0
            ;;
        *)
            echo "未知参数：$arg" >&2
            exit 2
            ;;
    esac
done

if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "==> 找不到 xcodebuild：iOS 产物只能在 macOS + Xcode 上编译" >&2
    echo "    Windows 先运行 ios/stage-web.ps1 准备 www/，再到 Mac 上执行本脚本" >&2
    exit 1
fi

# 版本号唯一来源：仓库根 VERSION（格式 x.xxx.xx）
# shellcheck source=../scripts/version.sh
. "$ROOT/scripts/version.sh"
VERSION="$(dsc_version)"
VERSION_CODE="$(dsc_version_code)"
echo "==> Version: $VERSION (versionCode $VERSION_CODE)"

if [ "$SKIP_WEB" -eq 0 ]; then
    echo "==> 构建网页产物"
    if command -v pwsh >/dev/null 2>&1; then
        pwsh -NoProfile -File "$ROOT/web/build-windows.ps1"
    else
        (cd "$ROOT/web" && NODE_ENV=production npx rspack build -c rspack.config.ts)
        # 与 web/build-windows.ps1 保持一致：产物发布到 release/web
        rm -rf "$ROOT/release/web"
        mkdir -p "$ROOT/release/web"
        cp -R "$ROOT/web/dist/static" "$ROOT/release/web/"
        cp "$ROOT/web/dist/index.html" "$ROOT/release/web/index.html"
        if [ -f "$ROOT/web/dist/LICENSE" ]; then cp "$ROOT/web/dist/LICENSE" "$ROOT/release/web/LICENSE"; fi
        cp "$ROOT/native/download-bridge.js" "$ROOT/release/web/static/js/download-bridge.js"
        node -e '
            const fs = require("fs");
            const file = process.argv[1];
            let html = fs.readFileSync(file, "utf8");
            if (!html.includes("static/js/download-bridge.js")) {
                html = html.replace(
                    /<script defer src="static\/js\/main\.[^"]+\.js"><\/script>/,
                    (tag) => `<script defer src="static/js/download-bridge.js"></script>${tag}`
                );
                fs.writeFileSync(file, html);
            }
        ' "$ROOT/release/web/index.html"
    fi
    echo "==> 同步 www/"
    if command -v pwsh >/dev/null 2>&1; then
        pwsh -NoProfile -File "$IOS_DIR/stage-web.ps1"
    else
        rm -rf "$IOS_DIR/DeepseekChatOnly/www"
        mkdir -p "$IOS_DIR/DeepseekChatOnly/www"
        cp "$ROOT/release/web/index.html" "$IOS_DIR/DeepseekChatOnly/www/"
        [ -f "$ROOT/logo.png" ] && cp "$ROOT/logo.png" "$IOS_DIR/DeepseekChatOnly/www/"
        cp -R "$ROOT/release/web/static" "$IOS_DIR/DeepseekChatOnly/www/"
        # 许可文件随 IPA 分发：GPLv3 + NOTICE + 上游 chat-demo 的 MIT 声明
        for item in LICENSE NOTICE LICENSES; do
            [ -e "$ROOT/release/web/$item" ] && cp -R "$ROOT/release/web/$item" "$IOS_DIR/DeepseekChatOnly/www/"
        done
        echo "==> www/ 就绪：$(find "$IOS_DIR/DeepseekChatOnly/www" -type f | wc -l | tr -d ' ') 个文件"
    fi
fi

if [ ! -f "$IOS_DIR/DeepseekChatOnly/www/index.html" ]; then
    echo "==> 缺少 ios/DeepseekChatOnly/www/index.html：先运行 ios/stage-web.ps1" >&2
    exit 1
fi

echo "==> xcodebuild（Release / iphoneos / 未签名）"
rm -rf "$BUILD_DIR"
xcodebuild \
    -project "$IOS_DIR/DeepseekChatOnly.xcodeproj" \
    -scheme DeepseekChatOnly \
    -configuration Release \
    -sdk iphoneos \
    -derivedDataPath "$BUILD_DIR" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$VERSION_CODE" \
    build

APP_PATH="$BUILD_DIR/Build/Products/Release-iphoneos/DeepseekChatOnly.app"
if [ ! -d "$APP_PATH" ]; then
    echo "==> 没有找到 $APP_PATH" >&2
    exit 1
fi
if [ ! -d "$APP_PATH/www" ]; then
    echo "==> 应用包里没有 www/：检查 Xcode 工程的 Resources 阶段" >&2
    exit 1
fi

echo "==> 打包 IPA"
mkdir -p "$DIST_DIR"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/Payload"
cp -R "$APP_PATH" "$STAGE/Payload/"
IPA="$DIST_DIR/DeepseekChatOnly-$VERSION-unsigned.ipa"
rm -f "$IPA"
(cd "$STAGE" && zip -qry "$IPA" Payload)

SIZE="$(du -h "$IPA" | awk '{print $1}')"
echo ""
echo "IPA: $IPA ($SIZE)"
echo "提示：未签名 IPA 需要重签名后安装（Sideloadly / AltStore / 自己的开发者证书）。"
