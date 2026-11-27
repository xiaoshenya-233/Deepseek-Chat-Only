# Stage the web build into desktop\web so Electron and electron-builder ship
# exactly the same assets as the Android shell.
#
# Source order: ..\web\dist (fresh official source build) -> ..\release\web
# (already published build). The download bridge from ..\native is injected
# when the source index.html does not reference it yet.
param(
    [string]$Desktop = $PSScriptRoot,
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $Desktop "..")

if (-not $Source) {
    $dist = Join-Path $root "web\dist"
    if (Test-Path (Join-Path $dist "index.html")) {
        $Source = $dist
    } else {
        $Source = Join-Path $root "release\web"
    }
}

$index = Join-Path $Source "index.html"
$static = Join-Path $Source "static"
if (-not (Test-Path $index)) { throw "index.html not found in $Source" }
if (-not (Test-Path $static)) { throw "static folder not found in $Source" }

$target = Join-Path $Desktop "web"
if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target | Out-Null
Copy-Item -LiteralPath $index -Destination $target
Copy-Item -LiteralPath $static -Destination $target -Recurse
# 许可文件随网页一起打包：GPLv3 + NOTICE + 上游 MIT 声明
foreach ($name in @("LICENSE", "NOTICE")) {
    $licenseFile = Join-Path $root $name
    if (Test-Path -LiteralPath $licenseFile) {
        Copy-Item -LiteralPath $licenseFile -Destination (Join-Path $target $name) -Force
    }
}
$mitDir = Join-Path $root "LICENSES"
if (Test-Path -LiteralPath $mitDir) {
    Copy-Item -LiteralPath $mitDir -Destination $target -Recurse -Force
}

# 安装目录根也要有许可：electron-builder 的 extraFiles 从这里取（web/** 已进 asar，不会再复制一次）
$licenseRoot = Join-Path $Desktop "licenses"
if (Test-Path -LiteralPath $licenseRoot) {
    Remove-Item -LiteralPath $licenseRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $licenseRoot | Out-Null
foreach ($name in @("LICENSE", "NOTICE")) {
    $licenseFile = Join-Path $root $name
    if (Test-Path -LiteralPath $licenseFile) {
        Copy-Item -LiteralPath $licenseFile -Destination $licenseRoot -Force
    }
}
if (Test-Path -LiteralPath $mitDir) {
    Copy-Item -LiteralPath $mitDir -Destination $licenseRoot -Recurse -Force
}

$targetIndex = Join-Path $target "index.html"
$html = [System.IO.File]::ReadAllText($targetIndex)
if ($html -notmatch "static/js/download-bridge\.js") {
    $shim = Join-Path $root "native\download-bridge.js"
    if (-not (Test-Path $shim)) { throw "Missing native\download-bridge.js" }
    Copy-Item -LiteralPath $shim -Destination (Join-Path $target "static\js\download-bridge.js") -Force
    $anchor = [regex]::Match($html, '<script defer src="static/js/main\.[^"]+\.js"></script>')
    if (-not $anchor.Success) { throw "Unable to locate the main bundle script tag" }
    $html = $html.Insert($anchor.Index, '<script defer src="static/js/download-bridge.js"></script>')
    [System.IO.File]::WriteAllText($targetIndex, $html, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "    download bridge injected"
}

$iconDirectory = Join-Path $Desktop "build"
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null
$icon = Join-Path $iconDirectory "icon.png"
if (-not (Test-Path $icon)) {
    Copy-Item -LiteralPath (Join-Path $root "logo.png") -Destination $icon
    Write-Host "    app icon copied from logo.png"
}

Write-Host ("    source: {0}" -f $Source)
Write-Host ("    web assets: {0} files" -f (Get-ChildItem $target -Recurse -File).Count)
