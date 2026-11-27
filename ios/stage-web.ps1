# 把 release/web 里的网页产物同步到 ios/DeepseekChatOnly/www（与 android/assets/www 同源）。
#
# 先跑 web\build-windows.ps1，它会把 index.html + static/ 发布到仓库根的 release\web\；
# 这里只做拷贝和校验，保证 APK / IPA 用的是同一份产物。
#
# 注意：脚本里的提示文字一律用英文。PowerShell 5.1 按系统代码页读取无 BOM 的脚本，
# 中文字符串会被解码坏掉并引发语法错误（注释里放中文没有问题）。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ios\stage-web.ps1
param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$www = Join-Path $PSScriptRoot "DeepseekChatOnly\www"
$release = Join-Path $Root "release\web"

$index = Join-Path $release "index.html"
$static = Join-Path $release "static"
$bridge = Join-Path $static "js\download-bridge.js"
# logo.png 是源码资产，仍在仓库根
$logo = Join-Path $Root "logo.png"

if (-not (Test-Path -LiteralPath $index)) {
    throw "Missing $index - run web\build-windows.ps1 first (it publishes to release\web)"
}
if (-not (Test-Path -LiteralPath $static)) {
    throw "Missing $static - run web\build-windows.ps1 first (it publishes to release\web)"
}
if (-not (Test-Path -LiteralPath $bridge)) {
    throw "Missing $bridge - the download bridge is required for exports"
}

if (Test-Path -LiteralPath $www) {
    Remove-Item -LiteralPath $www -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item -LiteralPath $index -Destination $www
if (Test-Path -LiteralPath $logo) {
    Copy-Item -LiteralPath $logo -Destination $www
}
Copy-Item -LiteralPath $static -Destination $www -Recurse
# 许可文件随 IPA 分发：GPLv3 + NOTICE + 上游 MIT 声明
foreach ($name in @("LICENSE", "NOTICE", "LICENSES")) {
    $item = Join-Path $release $name
    if (Test-Path -LiteralPath $item) {
        Copy-Item -LiteralPath $item -Destination $www -Recurse -Force
    }
}

$files = (Get-ChildItem $www -Recurse -File | Measure-Object).Count
$async = (Get-ChildItem (Join-Path $www "static\js\async") -File | Measure-Object).Count
Write-Host ("==> ios www ready: {0} files ({1} async chunks)" -f $files, $async)
Write-Host "    Next: run ios/build-ipa.sh on macOS (iOS binaries cannot be built on Windows)"

