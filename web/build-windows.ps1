# Build the official chat-demo source (web/) and publish the output to release/web,
# where android/build-apk.ps1, ios/stage-web.ps1 and desktop/prepare-web.ps1
# pick it up. The repository root stays free of generated files.
#
# release/ 是唯一的成品目录，按平台分子目录：
#   release/web/      index.html + static/ + LICENSE / NOTICE / LICENSES/
#   release/android/  *.apk
#   release/desktop/  *.exe / *.zip / *.deb
#   release/ios/      *.ipa
#
# Requirements: Node 22+, pnpm, and web/node_modules (pnpm install).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File web\build-windows.ps1
param(
    [string]$Web = $PSScriptRoot,
    [switch]$SkipNativeShim
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $Web "..")
$release = Join-Path $root "release"
# 网页成品放在 release\web，其它平台目录（android / desktop / ios）互不影响
$webOut = Join-Path $release "web"

Push-Location $Web
try {
    Write-Host "==> Building web app (NODE_ENV=production)"
    # Upstream's npm script relies on `rm -rf`, which Windows shells lack;
    # rspack already cleans dist because output.clean is enabled.
    $env:NODE_ENV = "production"
    & pnpm exec rspack build -c rspack.config.ts
    if ($LASTEXITCODE -ne 0) { throw "rspack build failed" }
} finally {
    Pop-Location
}

$dist = Join-Path $Web "dist"
$distIndex = Join-Path $dist "index.html"
if (-not (Test-Path $distIndex)) { throw "Build output is missing dist/index.html" }
$mainBundle = Get-ChildItem (Join-Path $dist "static\js") -Filter "main.*.js" -File |
    Select-Object -First 1
if (-not $mainBundle) { throw "Build output is missing static/js/main.*.js" }

Write-Host "==> Publishing to release/web/"
# 只重建 release\web：整个 release\ 里还有 android\desktop\ios 的成品，不能一起删。
if (Test-Path -LiteralPath $webOut) { Remove-Item -LiteralPath $webOut -Recurse -Force }
# 顺手清掉旧布局（成品曾直接放在 release\ 根下）
foreach ($legacy in @("index.html", "static", "LICENSE")) {
    $stale = Join-Path $release $legacy
    if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Recurse -Force }
}
New-Item -ItemType Directory -Force -Path $webOut | Out-Null
Copy-Item -LiteralPath (Join-Path $dist "static") -Destination $webOut -Recurse -Force
Copy-Item -LiteralPath $distIndex -Destination (Join-Path $webOut "index.html") -Force
# 许可随产物分发：产物根目录放 GPLv3 LICENSE 与 NOTICE，
# 上游 chat-demo 的 MIT 原文放在 LICENSES/ 里（MIT 要求再分发时保留，不能省）。
Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination (Join-Path $webOut "LICENSE") -Force
Copy-Item -LiteralPath (Join-Path $root "NOTICE") -Destination (Join-Path $webOut "NOTICE") -Force
$mitText = Join-Path $root "LICENSES\MIT-deepseek-chat-demo.txt"
if (Test-Path -LiteralPath $mitText) {
    $mitDir = Join-Path $webOut "LICENSES"
    New-Item -ItemType Directory -Force -Path $mitDir | Out-Null
    Copy-Item -LiteralPath $mitText -Destination $mitDir -Force
}

$indexPath = Join-Path $webOut "index.html"
$html = [System.IO.File]::ReadAllText($indexPath)

# Keep the download bridge outside of the web source until it is ported into
# src/services/chat/backup.ts; it must load before the main bundle.
if (-not $SkipNativeShim) {
    $shimSource = Join-Path $root "native\download-bridge.js"
    if (-not (Test-Path $shimSource)) { throw "Missing native\download-bridge.js" }
    $shimDir = Join-Path $webOut "static\js"
    if (-not (Test-Path -LiteralPath $shimDir)) { New-Item -ItemType Directory -Force -Path $shimDir | Out-Null }
    Copy-Item -LiteralPath $shimSource -Destination (Join-Path $shimDir "download-bridge.js") -Force
    if ($html -notmatch "static/js/download-bridge\.js") {
        $anchor = [regex]::Match($html, '<script defer src="static/js/main\.[^"]+\.js"></script>')
        if (-not $anchor.Success) { throw "Unable to locate the main bundle script tag" }
        $html = $html.Insert($anchor.Index,
            '<script defer src="static/js/download-bridge.js"></script>')
        [System.IO.File]::WriteAllText($indexPath, $html, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "    download bridge injected into release/web/index.html"
    } else {
        Write-Host "    download bridge already present in release/web/index.html"
    }
}

$releaseStatic = Join-Path $webOut "static"
$asyncCount = (Get-ChildItem (Join-Path $releaseStatic "js\async") -File).Count
$total = (Get-ChildItem $releaseStatic -Recurse -File).Count
Write-Host ("    release/web/static: {0} files ({1} async chunks), main bundle {2} ({3:N0} bytes)" -f `
        $total, $asyncCount, $mainBundle.Name, $mainBundle.Length)
Write-Host ("    published: {0}" -f $webOut)
Write-Host ""
Write-Host "Next: powershell -NoProfile -ExecutionPolicy Bypass -File android\build-apk.ps1"
