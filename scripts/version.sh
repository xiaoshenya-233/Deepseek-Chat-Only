#!/usr/bin/env bash
# 版本号唯一来源：仓库根的 VERSION 文件（格式 x.xxx.xx）。
#
#   x     重大更新
#   xxx   上游基线版本（deepseek-ai/chat-demo 的 v0.x.y 去掉点号，如 v0.1.30 -> 130）
#   xx    我们自己的构建/补丁次数（两位，不足补零）
#
# 用法：source scripts/version.sh 之后调用 dsc_version / dsc_semver / dsc_version_code
# 所有平台都必须从这里取值，不要在各自的配置文件里再写死版本号。

DSC_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

dsc_version() {
    local value
    value="$(tr -d ' \t\r\n' < "$DSC_REPO_ROOT/VERSION" 2>/dev/null || true)"
    if ! printf '%s' "$value" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "Invalid or missing $DSC_REPO_ROOT/VERSION (expected x.xxx.xx)" >&2
        return 1
    fi
    printf '%s' "$value"
}

# npm / electron-builder 只接受严格 semver：去掉前导零（0.130.01 -> 0.130.1）
dsc_semver() {
    dsc_version | awk -F. '{ printf "%d.%d.%d", $1, $2, $3 }'
}

# Android versionCode：x*1000000 + xxx*1000 + xx（0.130.01 -> 130001）
dsc_version_code() {
    dsc_version | awk -F. '{ printf "%d", $1 * 1000000 + $2 * 1000 + $3 }'
}
