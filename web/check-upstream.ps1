<#
.SYNOPSIS
  Read-only upstream drift check for https://github.com/deepseek-ai/chat-demo

.DESCRIPTION
  Runs `git fetch` (updates remote refs only, never touches the work tree or branch),
  then reports new commits / new tags / changed files against the pinned baseline tag,
  and flags two risk classes:
    * capability areas changed (src/services, src/app, src/utils, src/main.tsx)
    * files that also carry local patches -> must be replayed by hand

  This script NEVER merges, rebases or checks out anything.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File web\check-upstream.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File web\check-upstream.ps1 -OutFile ..\docs\upstream-report.md
#>
[CmdletBinding()]
param(
    [string]$Base = 'v0.1.3',
    [string]$Remote = 'origin',
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$report = New-Object System.Collections.Generic.List[string]

function Add-Line([string]$text) {
    $script:report.Add($text) | Out-Null
    Write-Host $text
}

Push-Location $repo
try {
    $env:GIT_TERMINAL_PROMPT = '0'

    git fetch --tags --prune $Remote 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed (network / proxy?)" }

    $defaultRef = "$Remote/main"
    git rev-parse --verify --quiet $defaultRef | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "remote branch $defaultRef not found; adjust -Remote or the branch name" }

    $baseCommit = (git rev-parse "$Base^{commit}").Trim()
    $headCommit = (git rev-parse $defaultRef).Trim()
    $range = "$baseCommit..$headCommit"
    $count = [int]((git rev-list --count $range).Trim())

    Add-Line '# Upstream drift report (chat-demo)'
    Add-Line ''
    Add-Line ("generated  : " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
    Add-Line ("repo       : " + $repo)
    Add-Line ("baseline   : $Base (" + $baseCommit.Substring(0, 7) + ")")
    Add-Line ("remote     : $defaultRef (" + $headCommit.Substring(0, 7) + ")")
    Add-Line ("new commits: $count")
    Add-Line ''

    if ($count -eq 0) {
        Add-Line 'VERDICT: baseline is up to date, nothing to sync.'
    }
    else {
        Add-Line '## New commits'
        Add-Line '```text'
        git --no-pager log --no-decorate --date=short --format='%h %ad %s' $range | ForEach-Object { Add-Line $_ }
        Add-Line '```'
        Add-Line ''

        # tags not reachable from the baseline yet
        $newTags = @()
        foreach ($t in @(git tag --sort=creatordate)) {
            git merge-base --is-ancestor $t $baseCommit 2>$null
            if ($LASTEXITCODE -ne 0) { $newTags += $t }
        }
        Add-Line '## New tags'
        if ($newTags.Count -eq 0) { Add-Line '(none)' } else { $newTags | ForEach-Object { Add-Line ('- ' + $_) } }
        Add-Line ''

        $changed = @(git --no-pager diff --name-only $range)
        $capability = @($changed | Where-Object { $_ -match '^src/(services|app|utils)/' -or $_ -match '^src/main\.tsx$' })
        $ui = @($changed | Where-Object { $_ -match '^src/components/' })
        $i18n = @($changed | Where-Object { $_ -match '^src/i18n/' })
        $style = @($changed | Where-Object { $_ -match '\.css$' })
        $dep = @($changed | Where-Object { $_ -match '^(package\.json|pnpm-lock\.yaml|rspack|tsconfig|\.npmrc)' })

        Add-Line '## Changed files by area'
        Add-Line ''
        Add-Line ('capability (src/services|app|utils, main.tsx): ' + $capability.Count)
        Add-Line ('ui         (src/components)              : ' + $ui.Count)
        Add-Line ('i18n       (src/i18n)                    : ' + $i18n.Count)
        Add-Line ('style      (*.css)                       : ' + $style.Count)
        Add-Line ('build/deps (package.json, rspack, ts..)  : ' + $dep.Count)
        Add-Line ''
        if ($capability.Count -gt 0) {
            Add-Line '### capability files'
            $capability | ForEach-Object { Add-Line ('- ' + $_) }
            Add-Line ''
        }

        # files that also carry local patches
        $localPatched = @(git --no-pager diff --name-only)
        $localUntracked = @(git ls-files --others --exclude-standard)
        $conflicts = @($changed | Where-Object { $localPatched -contains $_ })
        Add-Line '## Local patch overlap'
        Add-Line ''
        if ($localPatched.Count) { Add-Line ('local modified : ' + ($localPatched -join ', ')) } else { Add-Line 'local modified : (none)' }
        if ($localUntracked.Count) { Add-Line ('local untracked: ' + ($localUntracked -join ', ')) } else { Add-Line 'local untracked: (none)' }
        Add-Line ''
        if ($conflicts.Count -gt 0) {
            Add-Line 'CONFLICT: changed upstream AND patched locally (replay by hand):'
            $conflicts | ForEach-Object { Add-Line ('- ' + $_) }
        }
        else {
            Add-Line 'No overlap with local patches.'
        }
        Add-Line ''

        Add-Line '## Verdict'
        if ($capability.Count -gt 0) {
            Add-Line 'WARNING: capability layer changed -> compare each item against'
            Add-Line '         docs/upstream-sync.md (feature inventory) BEFORE merging;'
            Add-Line '         report any feature loss / behaviour change.'
        }
        elseif ($conflicts.Count -gt 0) {
            Add-Line 'INFO: UI/copy only, but local patches need replay (see conflicts above).'
        }
        else {
            Add-Line 'INFO: low risk (no capability files touched).'
        }
        Add-Line ''
        Add-Line 'Next: fill the comparison table, ask the user, then merge and replay patches.'
    }

    if ($OutFile) {
        $target = $OutFile
        if (-not [System.IO.Path]::IsPathRooted($target)) { $target = Join-Path $repo $target }
        $target = [System.IO.Path]::GetFullPath($target)
        $dir = Split-Path -Parent $target
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($target, ($report -join "`r`n"), $utf8NoBom)
        Write-Host ''
        Write-Host ('report written: ' + $target)
    }
}
finally {
    Pop-Location
}
