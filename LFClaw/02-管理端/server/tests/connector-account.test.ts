import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { strFromU8, unzipSync } from 'fflate'
import { AuthService } from '../src/auth.ts'
import { createApp } from '../src/app.ts'
import { createBackup, publicBackupArchive, restoreBackup } from '../src/backup.ts'
import { JsonStore, validateDatabase, type RecordItem } from '../src/store.ts'
import { accountConfiguration } from '../src/connector-account.ts'

test('未配置 OAuth 回调时明确报告部署错误并保留账号', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-oauth-config-'))
  const store = new JsonStore(join(directory, 'db.json'))
  const connector: RecordItem = { id: 'notion', name: 'Notion', type: 'mcp', enabled: true, scope: 'all',
    transport: 'streamable-http', endpoint: 'https://example.invalid/mcp',
    authentication: { type: 'oauth', owner: 'enterprise', fields: [] }, tools: [] }
  store.update(db => { db.connectors.push(connector) })
  const auth = new AuthService(join(directory, 'auth.json'), 'fixture-password', { adminMs: 60000, employeeMs: 60000 })
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'),
    allowedOrigin: 'http://127.0.0.1', mcpTimeoutMs: 2000, modelTimeoutMs: 2000,
    authWindowMs: 60000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const before = store.read().connectorAccounts
    const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/connectors/notion/credentials`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.login('admin', 'fixture-password')!}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'oauth', configuration: accountConfiguration(connector) }),
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json() as { code: string }).code, 'OAUTH_CALLBACK_UNAVAILABLE')
    assert.deepEqual(store.read().connectorAccounts, before)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})

interface Result {
  token: string
  revision: string
  connectors: Array<{ account: { configured: boolean }; tools: unknown[] }>
  content: Array<{ text: string }>
  code: string
}
const json = async (response: Response): Promise<Result> => await response.json() as Result

test('员工账号隔离、工具自动开放、凭据失效和备份脱敏贯穿真实 stdio 调用', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-accounts-'))
  const audit = join(directory, 'audit.jsonl')
  const store = new JsonStore(join(directory, 'db.json'))
  store.update(db => {
    db.employees = ['a', 'b'].map(id => ({ id, name: id, status: 'active', activationCode: `fixture-${id}` }))
  })
  const auth = new AuthService(join(directory, 'auth.json'), 'fixture-password', { adminMs: 60000, employeeMs: 60000 })
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'),
    allowedOrigin: 'http://127.0.0.1:5173', mcpTimeoutMs: 10000, modelTimeoutMs: 2000,
    authWindowMs: 60000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const admin = auth.login('admin', 'fixture-password')!
    const request = (path: string, token = admin, method = 'GET', body?: object) =>
      fetch(`http://127.0.0.1:${address.port}/api${path}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) })
    const connector: RecordItem = { id: 'wechat', name: '公众号', type: 'mcp', transport: 'stdio',
      command: process.execPath, args: [fileURLToPath(new URL('./fixtures/stdio-mcp.mjs', import.meta.url)), audit],
      env: { DATA_DIR: join(directory, 'accounts'), WECHAT_APP_ID: 'shared-id', WECHAT_APP_SECRET: 'shared-secret' },
      employeeCredentials: 'wechat-mp', enabled: true, scope: 'all', scopeTarget: [], tools: [] }
    assert.equal((await request('/admin/data/connectors', admin, 'POST', connector)).status, 201)
    assert.deepEqual(store.read().connectors[0]!.env, { DATA_DIR: join(directory, 'accounts') })
    const tokens = await Promise.all(['a', 'b'].map(async id => (await json(await request('/employee/activate', admin, 'POST',
      { code: `fixture-${id}` }))).token))
    const [a, b] = tokens as [string, string]
    const endpoint = '/employee/connectors/wechat/account'
    const catalog = async (token: string) => json(await request('/employee/connector-catalog', token))
    assert.equal((await catalog(a)).connectors[0]!.account.configured, false)
    assert.equal((await request('/admin/connectors/wechat/test', admin, 'POST', {})).status, 428)
    assert.equal((await request(endpoint, a, 'PUT', { appId: 'a', appSecret: '' })).status, 400)
    assert.equal((await request(endpoint, a, 'PUT', { employeeId: 'b', appId: 'a', appSecret: 'secret-a' })).status, 400)
    assert.equal((await request(endpoint, a, 'PUT', { appId: 'a', appSecret: 'secret-a' })).status, 200)
    assert.equal((await catalog(b)).connectors[0]!.account.configured, false)
    assert.equal((await catalog(a)).connectors[0]!.tools.length, 2)
    const discovered = store.read().connectors[0]!
    assert.deepEqual((discovered.tools as Array<{ allowed: boolean }>).map(item => item.allowed), [true, true])
    const call = (token: string, name = 'echo') => request('/employee/connectors/wechat/call', token, 'POST', { name, arguments: {} })
    assert.equal((await call(a)).status, 200)
    const allowed = { ...discovered, tools: (discovered.tools as RecordItem[]).map(tool => ({ ...tool, allowed: false })) }
    assert.equal((await request('/admin/data/connectors/wechat', admin, 'PUT', allowed)).status, 200)
    assert.equal((await call(a)).status, 200)
    assert.equal((await call(b)).status, 428)
    const beforeB = (await catalog(a)).revision
    assert.equal((await request(endpoint, b, 'PUT', { appId: 'b', appSecret: 'secret-b' })).status, 200)
    assert.equal((await catalog(a)).revision, beforeB)
    const output = async (token: string) => {
      const response = await call(token)
      assert.equal(response.status, 200)
      return JSON.parse((await json(response)).content[0]!.text) as { appId: string; secretDigest: string; dataDirectory: string }
    }
    const first = await output(a)
    const second = await output(b)
    assert.equal(first.appId, 'a'); assert.equal(second.appId, 'b')
    assert.equal(first.secretDigest, createHash('sha256').update('secret-a').digest('hex'))
    assert.equal(second.secretDigest, createHash('sha256').update('secret-b').digest('hex'))
    assert.notEqual(first.dataDirectory, second.dataDirectory)
    for (const response of [await request('/admin/data'), await request('/employee/me', b), await request('/admin/data/employees')]) {
      const text = await response.text()
      assert.equal(text.includes('secret-a'), false)
      assert.equal(text.includes('secret-b'), false)
      assert.equal(text.includes('connectorAccounts'), false)
    }
    const backup = createBackup(store, directory)
    const archive = readFileSync(join(directory, 'backups', `${backup.id}.zip`))
    assert.equal(strFromU8(unzipSync(archive)['database.json']!).includes('secret-a'), false)
    assert.equal(strFromU8(unzipSync(publicBackupArchive(archive))['database.json']!).includes('secret-b'), false)
    restoreBackup(archive, store, directory)
    assert.equal(store.read().connectorAccounts.length, 2)
    const rejected = await request(endpoint, a, 'PUT', { appId: 'a', appSecret: 'reject-fixture' })
    assert.equal(rejected.status, 502)
    assert.equal((await output(a)).secretDigest, first.secretDigest)
    assert.equal((await request(endpoint, a, 'PUT', { appId: 'changed', appSecret: '' })).status, 400)
    const held = call(a, 'hold')
    const deadline = Date.now() + 5000
    while (!readFileSync(audit, 'utf8').includes('"event":"hold"')) {
      assert(Date.now() < deadline); await delay(20)
    }
    assert.equal((await request(endpoint, a, 'DELETE')).status, 200)
    assert.equal((await held).status, 403)
    assert.equal((await call(a)).status, 428)
    assert.equal((await output(b)).appId, 'b')
    assert.equal((await request(endpoint, a, 'PUT', { appId: '', appSecret: '' })).status, 400)
    assert.equal((await request(endpoint, a, 'PUT', { appId: 'a', appSecret: 'new-secret-a' })).status, 200)
    assert.notEqual((await output(a)).dataDirectory, first.dataDirectory)
    const changed = { ...store.read().connectors[0]!, args: [...connector.args as string[], 'changed'] }
    assert.equal((await request('/admin/data/connectors/wechat', admin, 'PUT', changed)).status, 200)
    assert.equal((await catalog(a)).connectors[0]!.account.configured, false)
    assert.equal((await call(a)).status, 428)
    assert.equal((await request(endpoint, a, 'PUT', { appId: '', appSecret: '' })).status, 400)
    const legacy = { ...store.read() } as Record<string, unknown>
    delete legacy.connectorAccounts
    assert.deepEqual(validateDatabase(legacy).connectorAccounts, [])
    assert.throws(() => validateDatabase({ ...legacy, connectorAccounts: [{ employeeId: 'a' }] }))
    assert.equal((await request('/admin/data/employees/a', admin, 'DELETE')).status, 204)
    assert.equal(store.read().connectorAccounts.some(item => item.employeeId === 'a'), false)
  } finally {
    server.closeAllConnections(); server.close(); await once(server, 'close')
    rmSync(directory, { recursive: true, force: true })
  }
})
