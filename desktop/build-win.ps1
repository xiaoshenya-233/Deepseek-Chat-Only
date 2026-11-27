# Build the Windows desktop packages with mirrors, so electron-builder does not
# hit GitHub directly (a TLS-inspecting proxy otherwise fails with
# "unable to verify the first certificate").
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File build-win.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File build-win.ps1 -CaFile C:\certs\proxy-root.crt
param(
    [string]$CaFile = "",
    [switch]$SkipPrepare
)

$ErrorActionPreference = "Stop"

# 版本号唯一来源：仓库根的 VERSION（格式 x.xxx.xx）
. (Join-Path $PSScriptRoot "..\scripts\version.ps1")
$version = Get-DscVersion
Write-Host "==> Version: $version (from VERSION)"

# 国内镜像：Electron 二进制 + electron-builder 的 NSIS/7zip 工具链
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
# 没有代码签名证书时跳过签名（否则会尝试调用 signtool 并告警）
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

# 如果所在网络必须经过 TLS 代理，把代理根证书导出为 .crt/.pem 后传入 -CaFile
if ($CaFile) {
    if (-not (Test-Path -LiteralPath $CaFile)) { throw "CA file not found: $CaFile" }
    $env:NODE_EXTRA_CA_CERTS = (Resolve-Path -LiteralPath $CaFile).Path
    Write-Host "==> Using extra CA: $env:NODE_EXTRA_CA_CERTS"
}

Push-Location $PSScriptRoot
try {
    if (-not $SkipPrepare) {
        Write-Host "==> Staging web assets"
        & npm run prepare:web
        if ($LASTEXITCODE -ne 0) { throw "prepare:web failed" }
    }

    Write-Host "==> electron-builder (targets from package.json: nsis + portable + zip, x64)"
    & node (Join-Path $PSScriptRoot "build-versioned.mjs") --win --x64
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

    # release\desktop 要能直接拿去分发/上传，清掉打包过程的中间产物
    $outDir = Join-Path $PSScriptRoot "..\release\desktop"
    Write-Host "==> Cleaning intermediate artifacts"
    foreach ($name in @("win-unpacked", ".icon-ico", "builder-debug.yml")) {
        $path = Join-Path $outDir $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
    Get-ChildItem $outDir -File -Filter "*.nsis.7z" -ErrorAction SilentlyContinue | Remove-Item -Force
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "==> Artifacts in release\desktop\"
$outDir = Join-Path $PSScriptRoot "..\release\desktop"
Get-ChildItem $outDir -File -Filter *.exe -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending |
    Select-Object Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 1) } } |
    Format-Table -AutoSize
