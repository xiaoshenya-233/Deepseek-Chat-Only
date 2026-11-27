# iOS 入口脚本（Windows 用）。
#
# iOS 的 .ipa 只能在 macOS + Xcode 上编译；Windows 侧能做的只有两件事：
#   1. 把网页产物同步到 ios/DeepseekChatOnly/www
#   2. 校验工程文件齐全，方便拷到 Mac 上直接构建
#
# 提示文字统一用英文：PowerShell 5.1 会按系统代码页读取无 BOM 脚本，中文字符串会解析失败。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ios\build-ipa.ps1 -StageOnly
#
# 在 macOS 上请直接运行：./ios/build-ipa.sh
param(
    [switch]$StageOnly,
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$project = Join-Path $PSScriptRoot "DeepseekChatOnly.xcodeproj\project.pbxproj"
$scheme = Join-Path $PSScriptRoot "DeepseekChatOnly.xcodeproj\xcshareddata\xcschemes\DeepseekChatOnly.xcscheme"
$plist = Join-Path $PSScriptRoot "DeepseekChatOnly\Info.plist"

foreach ($required in @($project, $scheme, $plist)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "iOS project is incomplete: $required"
    }
}

Write-Host "==> Staging web assets"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stage-web.ps1") -Root $Root
if ($LASTEXITCODE -ne 0) {
    throw "stage-web.ps1 failed"
}

$xcodebuild = Get-Command xcodebuild -ErrorAction SilentlyContinue
if ($xcodebuild) {
    Write-Host "==> xcodebuild found, handing over to build-ipa.sh"
    & bash (Join-Path $PSScriptRoot "build-ipa.sh") --skip-web
    exit $LASTEXITCODE
}

$message = @(
    "",
    "No Xcode / iOS SDK on this machine, so no .ipa can be produced here.",
    "Web assets are ready (ios\DeepseekChatOnly\www). Two options:",
    "  - On macOS: run ./ios/build-ipa.sh from the repository root",
    "  - No Mac: push the repository to GitHub and run the ios-ipa workflow,",
    "    then download the DeepseekChatOnly unsigned IPA artifact.",
    "An unsigned IPA still needs re-signing before it installs on a device",
    "(Sideloadly / AltStore / your own developer certificate)."
) -join [Environment]::NewLine

if ($StageOnly) {
    Write-Host $message
    exit 0
}

Write-Host $message -ForegroundColor Yellow
exit 1

