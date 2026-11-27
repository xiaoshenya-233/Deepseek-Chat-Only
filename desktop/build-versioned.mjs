// 用仓库根 VERSION 作为版本号调用 electron-builder。
//
// 为什么要在外面套一层：electron-builder 只接受严格 semver，而 VERSION 允许
// "0.130.01" 这种带前导零的写法（x.xxx.xx）。desktop/package.json 里保留占位
// 版本 0.0.0（合法 semver），构建时用 extraMetadata 把 VERSION 原文注入，
// 于是产物文件名、安装包内 package.json、app.getVersion() 都是同一个字符串。
//
// 输出目录也在这里强制指定：release/desktop（所有成品统一在仓库根的 release/ 下），
// 不再生成 desktop/dist。desktop/package.json 的 directories.output 是同样的值（兜底）。
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const versionFile = path.join(here, '..', 'VERSION')
const outputDir = path.join(here, '..', 'release', 'desktop')

let version = ''
try {
  version = readFileSync(versionFile, 'utf8').trim()
} catch {
  console.error(`Missing ${versionFile}: VERSION is the single source of truth`)
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid VERSION "${version}": expected x.xxx.xx`)
  process.exit(1)
}

console.log(`==> Version ${version} (from VERSION)`)
console.log(`==> Output ${outputDir}`)
mkdirSync(outputDir, { recursive: true })

// 直接跑 electron-builder 的 cli.js：Node 20+ 起不允许在不开 shell 的情况下 spawn "npx.cmd"
// （CVE-2024-27980 的修复），用 process.execPath 调 JS 入口既跨平台又不受该限制。
const cli = path.join(here, 'node_modules', 'electron-builder', 'cli.js')
const result = spawnSync(
  process.execPath,
  [
    cli,
    `--config.extraMetadata.version=${version}`,
    `--config.directories.output=${outputDir}`,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', cwd: here }
)
if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
