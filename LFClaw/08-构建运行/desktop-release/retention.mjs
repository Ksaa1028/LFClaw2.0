/** 删除已发布桌面目标的过期安装文件及匹配归档；调用方须先完成发布验证。 */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * 每个目标保留最新两版；不接受链接目录、不识别的目标或非最新的发布编号。
 * @param {string} base 部署根目录。
 * @param {'win-x64'|'mac-arm64'} target 已验证的发布目标。
 * @param {string} releaseId 本次已验证的发布编号。
 * @returns {{ retained: string[], removed: string[] }} 保留版本及已删除的绝对路径。
 */
export function pruneDesktopReleases(base, target, releaseId) {
  const suffix = { 'win-x64': 'windows-x64\\.exe', 'mac-arm64': 'mac-arm64\\.dmg' }[target]
  if (!suffix || !/^\d{10}$/.test(releaseId)) throw new Error('无效的桌面发布目标或编号')
  const root = realpathSync(base)
  const desktop = join(root, 'desktop', target)
  const packages = join(root, 'packages')
  for (const directory of [desktop, packages]) {
    if (realpathSync(directory) !== resolve(directory)) throw new Error('发布目录不能经过符号链接')
  }
  const installerPattern = new RegExp(`^LFClaw-(\\d{10})-${suffix}$`)
  const files = readdirSync(desktop)
  const ids = files.flatMap(name => {
    const match = installerPattern.exec(name)
    if (!match) return []
    if (!lstatSync(join(desktop, name)).isFile()) throw new Error(`安装包不是普通文件：${name}`)
    return [match[1]]
  }).sort().reverse()
  if (ids[0] !== releaseId) throw new Error('已验证版本不是目录中的最新安装包，停止清理')
  const retained = ids.slice(0, 2)
  const stale = new Set(ids.slice(2))
  for (const name of ['nightly.yml', 'previous.json']) {
    const path = join(desktop, name)
    if (!existsSync(path)) continue
    const feed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(feed.files) || feed.files.length === 0) throw new Error('更新清单缺少文件引用')
    for (const file of feed.files) {
      const match = installerPattern.exec(file.url)
      if (!match || !retained.includes(match[1])) throw new Error('更新清单仍引用保留范围外的安装包')
    }
  }
  const candidates = []
  for (const name of files) {
    const match = installerPattern.exec(name.replace(/\.blockmap$/, ''))
    if (match && stale.has(match[1])) candidates.push(join(desktop, name))
  }
  for (const id of stale) {
    const archive = join(packages, `lfclaw-${target}-${id}.tar.gz`)
    if (existsSync(archive)) candidates.push(archive)
  }
  // 先核对整个删除集合，避免遇到异常条目后才发现部分清理已经发生。
  for (const file of candidates) {
    if (!lstatSync(file).isFile()) throw new Error(`清理目标不是普通文件：${file}`)
  }
  for (const file of candidates) unlinkSync(file)
  return { retained, removed: candidates }
}
