/** 校验完整归档后发布不可变安装包，最后原子替换 LFClaw 更新清单。 */
import { readFileSync, mkdirSync, mkdtempSync, existsSync, copyFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import * as tar from 'tar'
import { gt } from 'semver'
import { verifyLFClawUpdate } from '../../../apps/desktop/src/lfclaw-update-signature.ts'
import { pruneDesktopReleases } from './retention.mjs'

const archive = resolve(process.argv[2])
const base = '/opt/lfclaw-enterprise'
if (!archive.startsWith(`${base}/packages/`)) throw new Error('归档必须位于 LFClaw packages 目录')
const stage = mkdtempSync(join(base, 'packages/.desktop-stage-'))
try {
  await tar.t({ file: archive, onReadEntry(entry) {
    if (entry.type !== 'File' || !/^(release\.json|deploy\.mjs|nightly\.yml|update-public\.pem|LFClaw-\d{10}-windows-x64\.exe(?:\.blockmap)?)$/.test(entry.path)) throw new Error('归档包含非法条目')
  } })
  await tar.x({ file: archive, cwd: stage, strict: true })
  const manifest = JSON.parse(readFileSync(join(stage, 'release.json'), 'utf8'))
  if (manifest.product !== 'LFClaw' || manifest.target !== 'win-x64' || !/^\d{10}$/.test(manifest.releaseId)) throw new Error('发布清单身份无效')
  const expected = [`LFClaw-${manifest.releaseId}-windows-x64.exe`, `LFClaw-${manifest.releaseId}-windows-x64.exe.blockmap`, 'nightly.yml', 'update-public.pem']
  if (JSON.stringify(manifest.files.map(file => file.path).sort()) !== JSON.stringify([...expected].sort())) throw new Error('发布文件列表无效')
  for (const file of manifest.files) {
    const data = readFileSync(join(stage, file.path))
    if (data.length !== file.size || createHash('sha512').update(data).digest('hex') !== file.sha512) throw new Error(`文件校验失败：${file.path}`)
  }
  const feed = JSON.parse(readFileSync(join(stage, 'nightly.yml'), 'utf8'))
  verifyLFClawUpdate(feed, readFileSync(join(stage, 'update-public.pem'), 'utf8'))
  const installer = readFileSync(join(stage, expected[0]))
  if (feed.version !== manifest.version || feed.files[0].url !== expected[0] || feed.files[0].size !== installer.length
    || feed.files[0].sha512 !== createHash('sha512').update(installer).digest('base64')) throw new Error('签名清单与安装包不一致')
  const destination = join(base, 'desktop/win-x64')
  mkdirSync(destination, { recursive: true })
  const current = join(destination, 'nightly.yml')
  if (existsSync(current) && !gt(feed.version, JSON.parse(readFileSync(current, 'utf8')).version)) throw new Error('发布版本必须递增')
  for (const filename of expected.slice(0, 2)) {
    const target = join(destination, filename)
    if (existsSync(target)) {
      if (!readFileSync(target).equals(readFileSync(join(stage, filename)))) throw new Error('同一版本文件内容不同')
    } else copyFileSync(join(stage, filename), target, 1)
  }
  if (existsSync(current)) copyFileSync(current, join(destination, 'previous.json'))
  writeFileSync(join(destination, 'nightly.pending'), readFileSync(join(stage, 'nightly.yml')))
  renameSync(join(destination, 'nightly.pending'), current)
  console.log(`已发布 LFClaw ${feed.version}，安装包与清单校验通过`)
  const retention = pruneDesktopReleases(base, 'win-x64', manifest.releaseId)
  console.log(`保留版本：${retention.retained.join(', ')}；已清理 ${retention.removed.length} 个旧文件`)
} finally { rmSync(stage, { recursive: true, force: true }) }
