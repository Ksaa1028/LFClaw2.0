/** 发布文件保留策略的隔离文件系统验证。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneDesktopReleases } from './retention.mjs'

for (const target of ['win-x64', 'mac-arm64']) {
  test(`${target} keeps two versions and preserves unrelated files and the other platform`, t => {
    const root = mkdtempSync(join(tmpdir(), 'lfclaw-retention-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, 'packages'))
    for (const platform of ['win-x64', 'mac-arm64']) {
      const folder = join(root, 'desktop', platform)
      mkdirSync(folder, { recursive: true })
      for (const id of ['2026102109', '2026102110', '2026102201']) {
        const suffix = platform === 'win-x64' ? 'windows-x64.exe' : 'mac-arm64.dmg'
        writeFileSync(join(folder, `LFClaw-${id}-${suffix}`), 'installer')
        writeFileSync(join(folder, `LFClaw-${id}-${suffix}.blockmap`), 'map')
        writeFileSync(join(root, 'packages', `lfclaw-${platform}-${id}.tar.gz`), 'archive')
      }
      const suffix = platform === 'win-x64' ? 'windows-x64.exe' : 'mac-arm64.dmg'
      writeFileSync(join(folder, 'nightly.yml'), JSON.stringify({ files: [{ url: `LFClaw-2026102201-${suffix}` }] }))
    }
    assert.throws(() => pruneDesktopReleases(root, target, '2026102110'), /最新/)
    const result = pruneDesktopReleases(root, target, '2026102201')
    assert.deepEqual(result.retained, ['2026102201', '2026102110'])
    assert.equal(result.removed.length, 3)
    assert.ok(result.removed.every(file => !existsSync(file)))
    assert.ok(existsSync(join(root, 'desktop', target, 'nightly.yml')))
    const other = target === 'win-x64' ? 'mac-arm64' : 'win-x64'
    assert.ok(existsSync(join(root, 'packages', `lfclaw-${other}-2026102109.tar.gz`)))
    assert.equal(pruneDesktopReleases(root, target, '2026102201').removed.length, 0)
    const suffix = target === 'win-x64' ? 'windows-x64.exe' : 'mac-arm64.dmg'
    writeFileSync(join(root, 'desktop', target, 'previous.json'), JSON.stringify({ files: [{ url: `LFClaw-2026102109-${suffix}` }] }))
    assert.throws(() => pruneDesktopReleases(root, target, '2026102201'), /保留范围/)
  })
}
