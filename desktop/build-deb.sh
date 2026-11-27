#!/usr/bin/env bash
# Build a Debian package for the desktop shell.
#
# 产物：release/desktop/deepseek-chat-only_<version>_amd64.deb
# （所有成品统一在仓库根的 release/ 下，便于直接上传 GitHub Releases）
#
# 脚本用 BASH_SOURCE 自己定位仓库根，所以仓库搬家后不用改这里；
# 只需要把下面的 /mnt/e/Project/Deepseek-Chat-Only 换成你当前的实际路径。
#
#   wsl -d Debian -- env STEP=prep  bash /mnt/e/Project/Deepseek-Chat-Only/desktop/build-deb.sh
#   wsl -d Debian -- env STEP=build bash /mnt/e/Project/Deepseek-Chat-Only/desktop/build-deb.sh
#   wsl -d Debian -- env STEP=verify bash /mnt/e/Project/Deepseek-Chat-Only/desktop/build-deb.sh
#   (omit STEP to run all three)
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 版本号唯一来源：仓库根 VERSION（可用 VERSION= 覆盖，仅供调试）
# shellcheck source=../scripts/version.sh
. "$ROOT_DIR/../scripts/version.sh"
VERSION="${VERSION:-$(dsc_version)}"
ARCH="${ARCH:-amd64}"
PKG="deepseek-chat-only"
ELECTRON_VERSION="37.10.3"
WORK="/tmp/dsc-deb"
STAGE="$WORK/stage"
APP_DIR="/opt/$PKG"
DEB="$WORK/${PKG}_${VERSION}_${ARCH}.deb"
# 所有成品统一在仓库根的 release/ 下（release/desktop）
OUT_DIR="$ROOT_DIR/../release/desktop"

echo "==> Version: $VERSION (from VERSION)"

# Offline first: ELECTRON_ZIP > pre-downloaded desktop/.cache > network (WSL often cannot reach the internet)
LOCAL_ZIP="$ROOT_DIR/.cache/electron-v${ELECTRON_VERSION}-linux-x64.zip"
ZIP="${ELECTRON_ZIP:-}"
if [ -z "$ZIP" ] && [ -f "$LOCAL_ZIP" ]; then ZIP="$LOCAL_ZIP"; fi
if [ -z "$ZIP" ]; then ZIP="$WORK/electron-linux.zip"; fi

prep() {
  echo "==> [prep] workspace"
  rm -rf "$WORK"
  mkdir -p "$STAGE$APP_DIR" "$STAGE/DEBIAN" \
           "$STAGE/usr/bin" \
           "$STAGE/usr/share/applications" \
           "$STAGE/usr/share/icons/hicolor/512x512/apps"

  if [ ! -f "$ZIP" ]; then
    echo "==> [prep] downloading Electron $ELECTRON_VERSION"
    curl -L --fail --retry 3 -o "$ZIP" \
      "https://npmmirror.com/mirrors/electron/${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"
  fi
  echo "==> [prep] electron zip: $ZIP"

  python3 - "$ZIP" <<'PY'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall('/tmp/dsc-deb/electron')
PY
  cp -a "$WORK/electron/." "$STAGE$APP_DIR/"

  echo "==> [prep] staging app"
  APP="$STAGE$APP_DIR/resources/app"
  rm -f "$STAGE$APP_DIR/resources/default_app.asar"
  mkdir -p "$APP"
  cp -a "$ROOT_DIR/main.js" "$APP/main.js"
  cp -a "$ROOT_DIR/preload.js" "$APP/preload.js"
  cp -a "$ROOT_DIR/package.json" "$APP/package.json"
  # desktop/package.json 里是占位版本 0.0.0，打进 App 的副本换成 VERSION
  python3 - "$APP/package.json" "$VERSION" <<'PY'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)
data['version'] = version
with open(path, 'w', encoding='utf-8') as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
PY
  cp -a "$ROOT_DIR/web" "$APP/web"
  if [ -d "$ROOT_DIR/build" ]; then cp -a "$ROOT_DIR/build" "$APP/build"; fi
  # 许可随 deb 分发：GPLv3（LICENSE）+ NOTICE + 上游 chat-demo 的 MIT 声明
  if [ -f "$ROOT_DIR/../LICENSE" ]; then cp -a "$ROOT_DIR/../LICENSE" "$APP/LICENSE"; fi
  if [ -f "$ROOT_DIR/../NOTICE" ]; then cp -a "$ROOT_DIR/../NOTICE" "$APP/NOTICE"; fi
  if [ -d "$ROOT_DIR/../LICENSES" ]; then cp -a "$ROOT_DIR/../LICENSES" "$APP/LICENSES"; fi
  # 安装目录根再放一份，用户不用进 resources/app 才能看到许可
  if [ -f "$ROOT_DIR/../LICENSE" ]; then cp -a "$ROOT_DIR/../LICENSE" "$STAGE$APP_DIR/LICENSE.txt"; fi
  if [ -f "$ROOT_DIR/../NOTICE" ]; then cp -a "$ROOT_DIR/../NOTICE" "$STAGE$APP_DIR/NOTICE.txt"; fi
  if [ -d "$ROOT_DIR/../LICENSES" ]; then cp -a "$ROOT_DIR/../LICENSES" "$STAGE$APP_DIR/LICENSES"; fi

  echo "==> [prep] permissions"
  chmod 755 "$STAGE$APP_DIR/electron"
  chmod 4755 "$STAGE$APP_DIR/chrome-sandbox"
  if [ -f "$STAGE$APP_DIR/chrome_crashpad_handler" ]; then
    chmod 755 "$STAGE$APP_DIR/chrome_crashpad_handler"
  fi

  ln -sf "$APP_DIR/electron" "$STAGE/usr/bin/$PKG"
  cp -a "$ROOT_DIR/build/icon.png" "$STAGE/usr/share/icons/hicolor/512x512/apps/$PKG.png"

  cat > "$STAGE/usr/share/applications/$PKG.desktop" <<EOF
[Desktop Entry]
Name=Deepseek Chat Only
Comment=Third-party chat client built on deepseek-ai/chat-demo
Exec=$APP_DIR/electron %U
Terminal=false
Type=Application
Icon=$PKG
Categories=Utility;Network;
StartupWMClass=Deepseek Chat Only
EOF

  local installed_size
  installed_size=$(du -sk "$STAGE$APP_DIR" | cut -f1)
  cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Installed-Size: $installed_size
Maintainer: Deepseek Chat Only packager
Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libgbm1, libasound2 | libasound2t64
Description: Deepseek Chat Only desktop shell (third-party)
 Electron shell for the MIT-licensed deepseek-ai/chat-demo web build.
 Not an official DeepSeek product; local import / export work offline,
 chat requires your own API key.
EOF

  cat > "$STAGE/DEBIAN/postinst" <<EOF
#!/bin/sh
set -e
APP=$APP_DIR
if [ -f "\$APP/chrome-sandbox" ]; then
  chown root:root "\$APP/chrome-sandbox" || true
  chmod 4755 "\$APP/chrome-sandbox" || true
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
exit 0
EOF

  printf '#!/bin/sh\nset -e\nexit 0\n' > "$STAGE/DEBIAN/prerm"
  chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm"
  echo "==> [prep] done ($(du -sh "$STAGE" | cut -f1))"
}

buildpkg() {
  echo "==> [build] dpkg-deb"
  mkdir -p "$OUT_DIR"
  dpkg-deb --root-owner-group -Zgzip --build "$STAGE" "$DEB"
  cp -f "$DEB" "$OUT_DIR/"
  echo "==> [build] done -> $OUT_DIR/"
}

verify() {
  local target="$OUT_DIR/${PKG}_${VERSION}_${ARCH}.deb"
  echo "==> [verify] $target"
  dpkg-deb --info "$target" | head -20
  echo "--- size ---"
  ls -lh "$target"
  echo "--- entries (head) ---"
  dpkg-deb --contents "$target" | sed -n '1,10p'
  echo "--- sandbox mode ---"
  dpkg-deb --contents "$target" | grep -E 'chrome-sandbox' || true
  echo "--- app payload ---"
  dpkg-deb --contents "$target" | grep -E 'resources/app/(main\.js|preload\.js|package\.json)$|resources/app/web/index\.html$|usr/bin/|\.desktop$|apps/.*\.png$' || true
  echo DONE
}

case "${STEP:-all}" in
  prep) prep ;;
  build) buildpkg ;;
  verify) verify ;;
  all) prep; buildpkg; verify ;;
  *) echo "unknown STEP=$STEP"; exit 2 ;;
esac
