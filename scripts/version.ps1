# 版本号唯一来源：仓库根的 VERSION 文件（格式 x.xxx.xx）。
#
#   x     重大更新（我们自己定义的破坏性/大版本变更次数）
#   xxx   上游基线版本（对应 deepseek-ai/chat-demo 的 v0.x.y → 去掉点号，如 v0.1.30 → 130）
#   xx    我们自己的构建/补丁次数（两位，不足补零）
#
# 所有平台都必须从这里取值，不要再在各自的配置文件里写版本号。
# 提示文字用英文：PowerShell 5.1 会按系统代码页读取无 BOM 脚本，中文字符串会被解码坏掉。

$script:DscRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-DscVersion {
    $file = Join-Path $script:DscRepoRoot "VERSION"
    if (-not (Test-Path -LiteralPath $file)) {
        throw "Missing $file - VERSION is the single source of truth for the release version"
    }
    $value = [System.IO.File]::ReadAllText($file).Trim()
    if ($value -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
        throw "Invalid VERSION '$value' - expected x.xxx.xx"
    }
    return $value
}

# npm / electron-builder 只接受严格 semver，前导零（如 01）需要去掉：
# 0.130.01 -> 0.130.1。展示给用户的版本号仍然用 VERSION 原文。
function Get-DscSemver {
    $parts = (Get-DscVersion).Split('.')
    return ('{0}.{1}.{2}' -f [int]$parts[0], [int]$parts[1], [int]$parts[2])
}

# Android 的 versionCode 必须是单调递增的整数：x*1000000 + xxx*1000 + xx
# 例：0.130.01 -> 130001
function Get-DscVersionCode {
    $parts = (Get-DscVersion).Split('.')
    return ([int]$parts[0] * 1000000 + [int]$parts[1] * 1000 + [int]$parts[2])
}
