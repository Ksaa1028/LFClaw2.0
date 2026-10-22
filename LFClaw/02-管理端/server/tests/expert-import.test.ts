import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveExpertImport, ExpertImportError } from '../src/expert-import.ts'
import { JsonStore } from '../src/store.ts'

const settings = { scope: 'all', scopeTarget: [], enabled: false }
const member = (id: string) => ({ id, name: id, instructions: '核对资料，注明依据', description: '', tags: [] })

test('原创参数预览不写库，专家团成员 ID 重映射并保留顺序', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-import-'))
  try {
    const store = new JsonStore(join(directory, 'db.json'))
    const db = store.read()
    const before = structuredClone(db)
    const definition = { expert: { ...member('团'), kind: 'team', memberIds: ['b', 'a'] }, members: [member('a'), member('b')] }
    const result = resolveExpertImport(definition, db, settings)
    assert.deepEqual(db, before)
    assert.deepEqual(result.expert.memberIds, [result.members[1]!.id, result.members[0]!.id])
    assert.notEqual(result.members[0]!.id, 'a')
    assert.equal(store.read().experts.length, 0)
    store.update(current => { current.experts.push(...result.members, result.expert) })
    assert.equal(store.read().experts.length, 3)
    const changed = resolveExpertImport({ ...member('updated'), source: 'original' }, store.read(), { ...settings, targetId: result.members[0]!.id })
    assert.equal(changed.expert.id, result.members[0]!.id)
    assert.equal(changed.expert.name, 'updated')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('WorkBuddy 专家包迁移角色定义，不导入本机路径、技能文件或资源', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-workbuddy-import-'))
  try {
    const db = new JsonStore(join(directory, 'db.json')).read()
    const bundle = {
      schemaVersion: '1.0', source: { name: 'senior-developer', pluginPath: 'C:\\private\\expert' },
      manifest: { expertType: 'agent', displayName: { zh: '高级开发工程师', en: 'Senior developer' },
        displayDescription: { zh: '协助开发', en: 'Development support' }, tags: [{ zh: '开发', en: 'Development' }],
        skills: ['./skills/frontend-dev', './skills/fullstack-dev'] },
      agent: { path: 'agents/senior-developer.md', content: '按用户需求编写并验证代码。' },
      skills: [{ name: 'frontend-dev', files: [{ path: 'secret.txt', content: 'private' }] }],
      stats: { binaryFileCount: 2 },
    }
    const result = resolveExpertImport(bundle, db, settings)
    assert.equal(result.expert.name, '高级开发工程师')
    assert.equal(result.expert.instructions, bundle.agent.content)
    assert.deepEqual(result.expert.tags, ['开发'])
    assert.deepEqual(result.expert.skillIds, [])
    assert.deepEqual(result.migration, { source: 'WorkBuddy', skills: ['frontend-dev', 'fullstack-dev'], assets: 2 })
    assert.doesNotMatch(JSON.stringify(result.expert), /private|pluginPath|secret/)
    assert.equal(db.experts.length, 0)
    assert.throws(() => resolveExpertImport({ ...bundle, schemaVersion: '2.0' }, db, settings), /暂不支持/)
    assert.throws(() => resolveExpertImport({ ...bundle, agent: { content: '' } }, db, settings), /缺少可迁移/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('无效成员、依赖、来源和发布范围阻止整个导入', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-import-invalid-'))
  try {
    const store = new JsonStore(join(directory, 'db.json'))
    const db = store.read()
    const invalid = [
      { expert: { ...member('团'), kind: 'team' }, members: [member('a'), { ...member('b'), instructions: '' }] },
      { expert: { ...member('团'), kind: 'team' }, members: [member('a'), member('a')] },
      { expert: { ...member('团'), kind: 'team' }, members: [member('a'), { ...member('b'), kind: 'team' }] },
      { ...member('单'), skillIds: ['missing'] },
      { ...member('单'), source: 'bailian' },
      { ...member('单'), kind: 'unsupported' },
    ]
    for (const definition of invalid) {
      assert.throws(() => store.update(current => {
        const result = resolveExpertImport(definition, current, settings)
        current.experts.push(...result.members, result.expert)
      }), ExpertImportError)
      assert.deepEqual(store.read(), db)
    }
    assert.throws(() => resolveExpertImport(member('单'), db, { ...settings, scope: 'employee', scopeTarget: ['missing'] }), ExpertImportError)
    db.experts.push({ ...member('external'), source: 'bailian' }, { ...member('original'), source: 'dsh' })
    assert.throws(() => resolveExpertImport({ ...member('团'), kind: 'team', memberIds: ['external', 'original'] }, db, settings), ExpertImportError)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('导入接口要求管理员身份，预览不发布，保存专家团原子写入', async () => {
  const { once } = await import('node:events')
  const { createApp } = await import('../src/app.ts')
  const { AuthService } = await import('../src/auth.ts')
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-import-http-'))
  const store = new JsonStore(join(directory, 'db.json'))
  const auth = new AuthService(join(directory, 'auth.json'), 'import-test-password-123', { adminMs: 60_000, employeeMs: 60_000 })
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'),
    allowedOrigin: 'http://127.0.0.1:5173', expertTimeoutMs: 30_000, modelTimeoutMs: 30_000,
    authWindowMs: 60_000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    const root = `http://127.0.0.1:${address.port}/api/admin`
    const post = (path: string, body: object, token = '') => fetch(root + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    const definition = { expert: { ...member('团'), kind: 'team' }, members: [member('a'), member('b')] }
    assert.equal((await post('/experts/import', { definition, ...settings, preview: false })).status, 401)
    const login = await post('/login', { username: 'admin', password: 'import-test-password-123' })
    const { token } = await login.json() as { token: string }
    assert.equal((await post('/experts/import', { definition, ...settings, preview: true }, token)).status, 200)
    assert.equal(store.read().experts.length, 0)
    const portable = { schemaVersion: '1.0', source: { name: 'other-platform', pluginPath: '/private/path' },
      manifest: { expertType: 'agent', displayName: { zh: '迁移专家' }, skills: ['./skills/research'] },
      agent: { content: '核查用户资料并说明依据' }, stats: { binaryFileCount: 1 } }
    const migrated = await post('/experts/import', { definition: portable, ...settings, preview: true }, token)
    assert.equal(migrated.status, 200)
    const migratedResult = await migrated.json() as { expert: { name: string; skillIds: string[] }; migration: { skills: string[] } }
    assert.equal(migratedResult.expert.name, '迁移专家')
    assert.deepEqual(migratedResult.expert.skillIds, [])
    assert.deepEqual(migratedResult.migration.skills, ['research'])
    assert.equal(store.read().experts.length, 0)
    const invalid = { ...definition, members: [member('a'), { ...member('b'), instructions: '' }] }
    assert.equal((await post('/experts/import', { definition: invalid, ...settings, preview: false }, token)).status, 400)
    assert.equal(store.read().experts.length, 0)
    assert.equal((await post('/experts/import', { definition, ...settings, preview: false }, token)).status, 201)
    const published = store.read()
    assert.equal(published.experts.length, 3)
    assert.equal(published.experts.filter(item => item.source === 'team').length, 1)
    assert.equal(published.operationLogs.length, 1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
