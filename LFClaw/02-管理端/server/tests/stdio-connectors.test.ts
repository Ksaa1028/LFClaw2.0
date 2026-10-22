import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { AuthService } from '../src/auth.ts'
import { createApp } from '../src/app.ts'
import { JsonStore } from '../src/store.ts'
import { withMcp } from '../src/mcp.ts'

const fixture = fileURLToPath(new URL('./fixtures/stdio-mcp.mjs', import.meta.url))
interface FixtureResponse {
  env: Record<string, string>
  tools: Array<{ name: string }>
  token: string
  content: Array<{ text: string }>
  code: string
}
const json = async (response: Response): Promise<FixtureResponse> => await response.json() as FixtureResponse

function events(path: string): Array<{ event: string; pid: number }> {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    assert(Date.now() < deadline, 'fixture did not reach the expected state')
    await delay(20)
  }
}

function processExited(pid: number): boolean {
  try { process.kill(pid, 0); return false }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error }
}

test('stdio 保存、发现和员工调用使用服务器环境，遮盖密钥并在撤权时关闭进程', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-stdio-'))
  const auditFile = join(directory, 'audit.jsonl')
  const store = new JsonStore(join(directory, 'db.json'))
  store.update(db => { db.employees.push({ id: 'e1', name: '员工', status: 'active', activationCode: 'fixture-code' }) })
  const auth = new AuthService(join(directory, 'auth.json'), 'fixture-password', { adminMs: 60000, employeeMs: 60000 })
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'),
    allowedOrigin: 'http://127.0.0.1:5173', mcpTimeoutMs: 10000, modelTimeoutMs: 2000,
    authWindowMs: 60000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const previous = process.env.LFCLAW_TEST_PARENT_SECRET
  process.env.LFCLAW_TEST_PARENT_SECRET = 'must-not-be-inherited'
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const adminToken = auth.login('admin', 'fixture-password')!
    const request = (path: string, method = 'GET', body?: object, token = adminToken) =>
      fetch(`http://127.0.0.1:${address.port}/api${path}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) })
    const connector = { id: 'stdio', name: '本地工具', type: 'mcp', transport: 'stdio',
      command: process.execPath, args: [fixture, auditFile, 'value with spaces & 中文'],
      env: { FIXTURE_TOKEN: 'fixture-secret' }, enabled: true, scope: 'all', scopeTarget: [],
      tools: [{ id: 'echo', name: 'echo', allowed: true }, { id: 'hold', name: 'hold', allowed: true }] }
    for (const invalid of [{ transport: ['stdio'] }, { command: '' }, { args: 'not-array' }, { args: [1] },
      { env: { 'BAD=NAME': 'value' } }, { env: { TOKEN: 3 } }, { env: { TOKEN: '' } }]) {
      assert.equal((await request('/admin/data/connectors', 'POST', { ...connector, ...invalid })).status, 400)
    }
    const created = await request('/admin/data/connectors', 'POST', connector)
    assert.equal(created.status, 201)
    const visible = await json(created)
    assert.deepEqual(visible.env, { FIXTURE_TOKEN: '' })
    assert.equal(JSON.stringify(visible).includes('fixture-secret'), false)
    const masked = { ...connector, env: { FIXTURE_TOKEN: '' } }
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', masked)).status, 200)
    assert.deepEqual(store.read().connectors[0]?.env, connector.env)
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', { ...masked, args: [fixture, auditFile] })).status, 400)
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', { ...masked, command: 'other-command' })).status, 400)
    const discovery = await request('/admin/connectors/stdio/test', 'POST', {})
    assert.equal(discovery.status, 200)
    assert.deepEqual((await json(discovery)).tools.map(tool => tool.name), ['echo', 'hold'])
    const activation = await request('/employee/activate', 'POST', { code: 'fixture-code' })
    const token = (await json(activation)).token
    const catalog = await request('/employee/me', 'GET', undefined, token)
    const catalogText = await catalog.text()
    assert.equal(catalog.status, 200)
    assert.equal(catalogText.includes('FIXTURE_TOKEN'), false)
    assert.equal(catalogText.includes('fixture-secret'), false)
    assert.equal(catalogText.includes(fixture), false)
    const tools = await request('/employee/connectors/stdio/tools', 'GET', undefined, token)
    assert.equal(tools.status, 200)
    assert.equal((await json(tools)).tools.length, 2)
    const call = await request('/employee/connectors/stdio/call', 'POST', { name: 'echo', arguments: {} }, token)
    assert.equal(call.status, 200)
    assert.deepEqual(JSON.parse((await json(call)).content[0]!.text), {
      argument: 'value with spaces & 中文', credential: 'fixture-secret', inheritedCredential: null,
    })
    const beforeDenied = events(auditFile).length
    assert.equal((await request('/employee/connectors/stdio/call', 'POST', { name: 'not-allowed', arguments: {} }, token)).status, 403)
    assert.equal(events(auditFile).length, beforeDenied)
    const pending = request('/employee/connectors/stdio/call', 'POST', { name: 'hold', arguments: {} }, token)
    await waitUntil(() => events(auditFile).some(event => event.event === 'hold'))
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', { ...masked, enabled: false })).status, 200)
    const revoked = await pending
    assert.equal(revoked.status, 403)
    assert.equal((await json(revoked)).code, 'CONNECTOR_ACCESS_CHANGED')
    await waitUntil(() => events(auditFile).every(event => processExited(event.pid)))
    assert.equal((await request('/employee/connectors/stdio/call', 'POST', { name: 'echo', arguments: {} }, token)).status, 403)
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', { ...masked, env: {} })).status, 200)
    assert.deepEqual(store.read().connectors[0]?.env, {})
    const failed = { ...connector, command: join(directory, 'missing-executable'), env: {} }
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', failed)).status, 200)
    const unavailable = await request('/admin/connectors/stdio/test', 'POST', {})
    assert.equal(unavailable.status, 502)
    assert.equal((await json(unavailable)).code, 'MCP_UNAVAILABLE')
    assert.equal((await request('/admin/data/connectors/stdio', 'PUT', {
      ...connector, transport: 'sse', endpoint: 'https://example.invalid/sse', headers: {},
    })).status, 200)
    const remote = store.read().connectors[0]!
    assert.equal(remote.command, undefined)
    assert.equal(remote.args, undefined)
    assert.deepEqual(remote.env, {})
  } finally {
    if (previous === undefined) delete process.env.LFCLAW_TEST_PARENT_SECRET
    else process.env.LFCLAW_TEST_PARENT_SECRET = previous
    server.closeAllConnections(); server.close(); await once(server, 'close')
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stdio 超时关闭等待中的工具和进程', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-stdio-timeout-'))
  const auditFile = join(directory, 'audit.jsonl')
  try {
    await assert.rejects(withMcp({ transport: 'stdio', command: process.execPath,
      args: [fixture, auditFile], env: {}, timeoutMs: 1500 }, async client => {
      await client.callTool({ name: 'hold', arguments: {} })
    }))
    assert(events(auditFile).some(event => event.event === 'hold'))
    await waitUntil(() => events(auditFile).every(event => processExited(event.pid)))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
