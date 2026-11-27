# Run the desktop app on machines where executing electron from
# <repo>\desktop\node_modules fails (Chromium CHECK / 0xC0000005 caused by
# local security software). The Electron distribution is mirrored to a temp
# directory and started from there; the app itself is unchanged.
#
# Usage:
#   powershell -File desktop\run-local.ps1                 # normal window
#   powershell -File desktop\run-local.ps1 -AppArgs '--smoke'
#   powershell -File desktop\run-local.ps1 -AppArgs '--capture','..\dist\screenshots'
param(
    [string]$App = $PSScriptRoot,
    [string[]]$AppArgs = @()
)

$ErrorActionPreference = "Stop"
$dist = Join-Path $App "node_modules\electron\dist"
$exe = Join-Path $dist "electron.exe"
if (-not (Test-Path $exe)) {
    throw "Electron is not installed. Run 'npm install' in desktop\ first."
}

$runner = Join-Path $env:TEMP "dsc-electron-runner"
$version = (Get-Content (Join-Path $dist "version") -Raw).Trim()
$runnerVersion = if (Test-Path (Join-Path $runner "version")) {
    (Get-Content (Join-Path $runner "version") -Raw).Trim()
} else {
    ""
}
if ($version -ne $runnerVersion) {
    if (Test-Path $runner) { Remove-Item -LiteralPath $runner -Recurse -Force }
    Copy-Item -LiteralPath $dist -Destination $runner -Recurse -Force
    Write-Host "electron $version mirrored to $runner"
}

& (Join-Path $runner "electron.exe") $App @AppArgs
exit $LASTEXITCODE
