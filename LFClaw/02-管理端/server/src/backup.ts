/** 企业数据与技能附件的手动备份；不含员工设备上的会话文件。 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { validateDatabase, type JsonStore, type RecordItem } from './store.ts'

const skillFilename = /^[0-9a-f-]{36}\.zip$/

function digest(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }

interface Manifest { format: 1; files: Record<string, string> }

/** 为管理员生成可下载且可校验的独立 ZIP。 */
export function createBackup(store: JsonStore, dataDirectory: string): RecordItem {
  const db = store.read()
  const files: Record<string, Uint8Array> = { 'database.json': strToU8(JSON.stringify({ ...db, personalExperts: [], connectorAccounts: [], workflows: [] })) }
  const skillFiles = new Set<string>()
  for (const skill of db.skills) {
    if (typeof skill.zipPath === 'string' && skill.zipPath) skillFiles.add(skill.zipPath)
    if (Array.isArray(skill.history)) {
      for (const value of skill.history) {
        if (typeof value !== 'object' || value === null || !('zipPath' in value)
          || typeof value.zipPath !== 'string') throw new Error('技能历史附件路径无效，无法完成备份')
        skillFiles.add(value.zipPath)
      }
    }
  }
  for (const filename of skillFiles) {
    if (!skillFilename.test(filename)) throw new Error('技能附件路径无效，无法完成备份')
    files[`skills/${filename}`] = readFileSync(join(dataDirectory, 'skills', filename))
  }
  const manifest: Manifest = { format: 1, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, digest(data)])) }
  files['manifest.json'] = strToU8(JSON.stringify(manifest))
  const archive = zipSync(files, { level: 6 })
  const directory = join(dataDirectory, 'backups')
  mkdirSync(directory, { recursive: true })
  const id = randomUUID()
  writeFileSync(join(directory, `${id}.zip`), archive, { mode: 0o600, flag: 'wx' })
  const createdAt = new Date().toISOString()
  const record: RecordItem = { id, name: `manual-backup-${createdAt.slice(0, 10)}`, time: createdAt,
    createdAt, type: 'manual', size: archive.byteLength, sizeBytes: archive.byteLength, status: 'success' }
  store.update(current => {
    current.backups.unshift(record)
    current.operationLogs.unshift({ id: randomUUID(), time: createdAt,
      type: 'create:backups', object: id, change: `已创建手动备份「${String(record.name)}」`, operator: 'admin' })
  })
  return record
}

function readBackup(archive: Uint8Array): { entries: Record<string, Uint8Array>; names: string[]; restored: ReturnType<typeof validateDatabase>; expected: Record<string, unknown> } {
  let totalSize = 0
  let count = 0
  const entries = unzipSync(archive, { filter: file => {
    totalSize += file.originalSize
    count += 1
    if (totalSize > 100 * 1024 * 1024 || count > 300) throw new Error('备份内容超出限制')
    return true
  } })
  const rawManifest = entries['manifest.json']
  const database = entries['database.json']
  if (!rawManifest || !database) throw new Error('备份缺少数据或清单')
  const manifest: unknown = JSON.parse(strFromU8(rawManifest))
  if (!manifest || typeof manifest !== 'object' || !('format' in manifest) || manifest.format !== 1
    || !('files' in manifest) || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('备份版本不受支持')
  }
  const expected = manifest.files as Record<string, unknown>
  const names = Object.keys(entries).filter(name => name !== 'manifest.json').sort()
  if (names.length !== Object.keys(expected).length || names.some(name =>
    !((name === 'database.json' || /^skills\/[0-9a-f-]{36}\.zip$/.test(name))
      && typeof expected[name] === 'string' && expected[name] === digest(entries[name]!)))) {
    throw new Error('备份内容完整性校验失败')
  }
  const parsed: unknown = JSON.parse(strFromU8(database))
  const restored = validateDatabase(parsed)
  return { entries, names, restored, expected }
}

/** 管理员下载时再次脱敏旧归档，防止历史备份暴露员工私人专家。 */
export function publicBackupArchive(archive: Uint8Array): Uint8Array {
  const { entries, restored } = readBackup(archive)
  entries['database.json'] = strToU8(JSON.stringify({ ...restored, personalExperts: [], connectorAccounts: [], workflows: [] }))
  const files = Object.fromEntries(Object.entries(entries).filter(([name]) => name !== 'manifest.json'))
  entries['manifest.json'] = strToU8(JSON.stringify({ format: 1,
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, digest(data)])) }))
  return zipSync(entries, { level: 6 })
}

/** 上传恢复前验证归档完整性；失败时保留原数据库。 */
export function restoreBackup(archive: Uint8Array, store: JsonStore, dataDirectory: string): void {
  const { entries, names, restored, expected } = readBackup(archive)
  restored.workflows = store.read().workflows
  restored.personalExperts = store.read().personalExperts
  restored.backups = []
  const safety = createBackup(store, dataDirectory)
  const skillsDirectory = join(dataDirectory, 'skills')
  mkdirSync(skillsDirectory, { recursive: true })
  for (const name of names) {
    if (name === 'database.json') continue
    const path = join(skillsDirectory, name.slice('skills/'.length))
    if (existsSync(path)) {
      if (digest(readFileSync(path)) !== expected[name]) throw new Error('本地技能附件与备份同名但内容不同')
    } else writeFileSync(path, entries[name]!, { mode: 0o600, flag: 'wx' })
  }
  store.replace(restored)
  store.update(current => {
    if (!current.backups.some(item => item.id === safety.id)) current.backups.unshift(safety)
    current.operationLogs.unshift({ id: randomUUID(), time: new Date().toISOString(),
      type: 'restore:backups', object: safety.id, change: '恢复备份，保留恢复前安全备份', operator: 'admin' })
  })
}
