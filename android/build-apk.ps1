# Build a signed, installable APK for the bundled web app without Gradle.
#
# Requirements: JDK 17+ (javac, keytool), Python 3 with Pillow (only for the icon),
# and the Android SDK build-tools + platform zips unpacked under .apkbuild/.
#
# 网页资源取自 release\web（web\build-windows.ps1 的发布目标），
# 最终 APK 落到 release\android\（所有成品统一在 release\ 下）。
#
#   pwsh -File android\build-apk.ps1
param(
    [string]$BuildTools = "$PSScriptRoot\..\.apkbuild\bt\android-15",
    [string]$PlatformJar = "$PSScriptRoot\..\.apkbuild\pf\android-35\android.jar",
    [string]$OutDir = "$PSScriptRoot\..\release\android",
    [string]$Python = "python",
    [switch]$SkipIcon
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$android = $PSScriptRoot
$build = Join-Path $android "build"
$assets = Join-Path $android "assets"
$www = Join-Path $assets "www"

# 版本号唯一来源：仓库根的 VERSION（格式 x.xxx.xx）；versionCode 由它派生
. (Join-Path $root "scripts\version.ps1")
$version = Get-DscVersion
$versionCode = Get-DscVersionCode
Write-Host "==> Version: $version (versionCode $versionCode)"

Write-Host "==> Syncing web assets"
$pythonExe = $null
if (-not $SkipIcon) {
    try {
        & $Python -c "import sys" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $pythonExe = $Python }
    } catch {
        $pythonExe = $null
    }
}
if ($SkipIcon) {
    Write-Host "    launcher icon regeneration skipped (-SkipIcon)"
} elseif ($pythonExe) {
    & $pythonExe "$android\tools\make_icon.py"
    if ($LASTEXITCODE -ne 0) { throw "Launcher icon generation failed" }
} elseif (Test-Path "$android\res\mipmap-xxxhdpi\ic_launcher.png") {
    Write-Host "    Python not available: reusing the existing launcher icons under res/"
} else {
    throw "Launcher icons are missing and Python with Pillow is required to generate them"
}
if (Test-Path $www) { Remove-Item -Recurse -Force $www }
New-Item -ItemType Directory -Force -Path $www | Out-Null
# Web 产物统一从 release\web 取（web/build-windows.ps1 的发布目标）；
# logo.png 是源码资产，仍在仓库根。
$release = Join-Path $root "release\web"
if (-not (Test-Path (Join-Path $release "index.html"))) {
    throw "Missing $release\index.html - run web\build-windows.ps1 first"
}
Copy-Item (Join-Path $release "index.html") $www
Copy-Item "$root\logo.png" $www
Copy-Item (Join-Path $release "static") $www -Recurse
# 许可文件随 APK 分发：GPLv3 + NOTICE + 上游 chat-demo 的 MIT 声明
foreach ($name in @("LICENSE", "NOTICE", "LICENSES")) {
    $item = Join-Path $release $name
    if (Test-Path -LiteralPath $item) {
        Copy-Item -LiteralPath $item -Destination $www -Recurse -Force
    }
}

Write-Host "==> Compiling resources"
if (Test-Path $build) { Remove-Item -Recurse -Force $build }
New-Item -ItemType Directory -Force -Path "$build\gen", "$build\classes", "$build\dex" | Out-Null
& "$BuildTools\aapt2.exe" compile --dir "$android\res" -o "$build\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

Write-Host "==> Linking APK"
& "$BuildTools\aapt2.exe" link `
    -o "$build\app-unsigned.apk" `
    -I $PlatformJar `
    --manifest "$android\AndroidManifest.xml" `
    -R "$build\res.zip" `
    -A $assets `
    --java "$build\gen" `
    --version-code $versionCode `
    --version-name $version `
    --replace-version `
    --auto-add-overlay `
    -0 arsc `
    --no-version-vectors
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

Write-Host "==> Compiling Java"
$sources = @(Get-ChildItem "$android\src" -Recurse -Filter *.java | ForEach-Object FullName)
$sources += @(Get-ChildItem "$build\gen" -Recurse -Filter *.java | ForEach-Object FullName)
& javac --release 11 -Xlint:-options -classpath $PlatformJar -d "$build\classes" $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

Write-Host "==> Dexing"
& "$BuildTools\d8.bat" --release --min-api 24 --lib $PlatformJar --output "$build\dex" `
    (Get-ChildItem "$build\classes" -Recurse -Filter *.class | ForEach-Object FullName)
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

Write-Host "==> Packaging"
# PowerShell based dex appender: keeps every existing entry byte-identical and
# therefore keeps resources.arsc uncompressed (Android 11+ requirement).
& powershell -NoProfile -ExecutionPolicy Bypass -File "$android\tools\append_zip_entry.ps1" `
    -Apk "$build\app-unsigned.apk" -Entry "$build\dex\classes.dex" -Name "classes.dex"
if ($LASTEXITCODE -ne 0) { throw "add dex failed" }

Write-Host "==> Normalizing APK entries"
& javac --release 11 -d "$build\tools" "$android\tools\NormalizeApk.java"
if ($LASTEXITCODE -ne 0) { throw "NormalizeApk compilation failed" }
& java -cp "$build\tools" NormalizeApk "$build\app-unsigned.apk" "$build\app-normalized.apk"
if ($LASTEXITCODE -ne 0) { throw "APK normalization failed" }

Write-Host "==> Aligning (4 KB and 16 KB page compatible)"
& "$BuildTools\zipalign.exe" -f -P 16 4 "$build\app-normalized.apk" "$build\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

$keystore = Join-Path $android "debug.keystore"
if (-not (Test-Path $keystore)) {
    Write-Host "==> Creating debug keystore"
    & keytool -genkeypair -keystore $keystore -alias androiddebugkey -storepass android `
        -keypass android -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=Android Debug,O=Android,C=US" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

Write-Host "==> Signing (v1 + v2 + v3)"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$apk = Join-Path $OutDir "Deepseek Chat Only.apk"
& "$BuildTools\apksigner.bat" sign --ks $keystore --ks-pass pass:android --key-pass pass:android `
    --min-sdk-version 24 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
    --out $apk "$build\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

& "$BuildTools\apksigner.bat" verify --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }

# apksigner 的 v4 分离签名（*.idsig）只用于增量安装，分发用不到，别让它留在 release\android\
$idsig = "$apk.idsig"
if (Test-Path -LiteralPath $idsig) { Remove-Item -LiteralPath $idsig -Force }

Write-Host ""
Write-Host "APK: $apk ($([math]::Round((Get-Item $apk).Length / 1MB, 2)) MB)"
