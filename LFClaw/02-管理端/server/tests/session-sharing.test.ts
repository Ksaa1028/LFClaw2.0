import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import express from 'express'
import { SessionShares, mountSessionSharing } from '../src/session-sharing.ts'
import { AuthService, activationHash } from '../src/auth.ts'
import { JsonStore } from '../src/store.ts'

test('分享支持跨部门多选，下载鉴权，通知独立删除，停用与重置立即生效', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lfclaw-shares-'))
  const store = new JsonStore(join(root, 'db.json'))
  store.update(db => {
    db.departments = [{ id: 'a', name: '一部' }, { id: 'b', name: '二部' }]
    db.employees = ['sender', 'recipient', 'other', 'stranger'].map((id, index) => ({ id, name: id, departmentId: index ? 'b' : 'a', status: 'active', activationCode: `code-${id}` }))
  })
  const auth = new AuthService(join(root, 'auth.json'), 'password-at-least-twelve', { adminMs: 3600000, employeeMs: 3600000 })
  const tokens = Object.fromEntries(['sender', 'recipient', 'other', 'stranger'].map(employeeId => [employeeId,
    auth.issue({ principal: 'employee', employeeId, activationCodeHash: activationHash(`code-${employeeId}`) })]))
  const admin = auth.issue({ principal: 'admin' })
  const app = express()
  mountSessionSharing(app, { skillArchiveLimits, store, auth, dataDirectory: root, skillsDirectory: join(root, 'skills'), allowedOrigin: '',
    modelTimeoutMs: 1000, authWindowMs: 1000, loginMaxFailures: 3, activationMaxFailures: 3 })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/employee/session-shares`
  async function request(path = '', token?: string, body?: unknown, method?: string) {
    return fetch(url + path, { method: method ?? (body ? 'POST' : 'GET'),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  const payload = { version: 1, header: { type: 'session', version: 4, id: 'source' },
    events: [{ type: 'user/message', seq: 0, time: 1, data: { text: '原始聊天' } }],
    files: [{ key: createHash('sha256').update('原始附件').digest('hex'), name: '原始.txt', data: Buffer.from('原始附件').toString('base64') },
      { key: 'path:output', name: '输出.txt', data: Buffer.from('AI输出').toString('base64') }] }
  try {
    assert.equal((await request('/employees')).status, 401)
    assert.equal((await request('/employees', admin)).status, 401)
    const employees = await (await request('/employees?q=二部', tokens.sender)).json() as { id: string }[]
    assert.equal(employees.length, 3)
    assert.equal(JSON.stringify(employees).includes('code-'), false)
    assert.equal((await request('', tokens.sender, { title: '测试', recipients: ['missing'], payload })).status, 400)
    assert.equal((await request('', tokens.sender, { title: '测试', recipients: ['recipient', 'recipient'], payload })).status, 400)
    const sent = await request('', tokens.sender, { title: '含附件的聊天', recipients: ['recipient', 'other'], payload })
    assert.equal(sent.status, 201)
    const share = await sent.json() as { id: string; expiresAt: number }
    const before = readFileSync(join(root, 'db.json'), 'utf8')
    assert.deepEqual(await (await request(`/${share.id}/download`, tokens.recipient)).json(), payload)
    assert.equal((await request(`/${share.id}/download`, tokens.stranger)).status, 404)
    assert.equal((await request('/../../db.json/download', tokens.recipient)).status, 404)
    const notices = await (await request('/notices', tokens.recipient)).json() as { id: string; read: boolean; shareId: string }[]
    assert.equal(notices.length, 1)
    assert.equal(notices[0]?.read, false)
    await request('/notices', tokens.recipient, { id: notices[0]!.id, action: 'read' })
    const secondDevice = auth.issue({ principal: 'employee', employeeId: 'recipient', activationCodeHash: activationHash('code-recipient') })
    assert.equal((await (await request('/notices', secondDevice)).json() as { read: boolean }[])[0]?.read, true)
    await request('/notices', tokens.recipient, { id: notices[0]!.id, action: 'delete' })
    assert.deepEqual(await (await request('/notices', secondDevice)).json(), [])
    assert.equal((await request(`/${share.id}/download`, secondDevice)).status, 200)
    assert.equal((await (await request('/notices', tokens.other)).json() as unknown[]).length, 1)
    assert.equal(readFileSync(join(root, 'db.json'), 'utf8'), before)
    store.update(db => { db.employees.find(e => e.id === 'recipient')!.status = 'inactive' })
    assert.equal((await request(`/${share.id}/download`, secondDevice)).status, 401)
    store.update(db => { db.employees.find(e => e.id === 'recipient')!.status = 'active' })
    assert.equal((await request(`/${share.id}/download`, secondDevice)).status, 200)
    store.update(db => { db.employees.find(e => e.id === 'recipient')!.activationCode = 'reset' })
    assert.equal((await request(`/${share.id}/download`, secondDevice)).status, 401)
    const policyUrl = `http://127.0.0.1:${address.port}/api/admin/session-sharing`
    assert.equal((await fetch(policyUrl, { method: 'PUT', headers: { Authorization: `Bearer ${tokens.sender}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ maxBytes: 1024, retentionDays: 1 }) })).status, 401)
    assert.equal((await fetch(policyUrl, { method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ maxBytes: 1024, retentionDays: 1 }) })).status, 200)
    assert.equal(store.read().operationLogs[0]?.type, 'update:session-sharing')
    assert.equal((await request('', tokens.sender, { title: '超限', recipients: ['other'], payload: { ...payload,
      events: [{ type: 'user/message', seq: 0, time: 1, data: { text: 'x'.repeat(1025) } }] } })).status, 413)
    assert.equal((await request('', tokens.sender, { title: '坏编码', recipients: ['other'], payload: { ...payload, files: [{ key: 'x', name: 'x', data: '!!!' }] } })).status, 400)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('分享到期阻止下载并清理磁盘，通知保留30天；损坏索引与文件明确失败', t => {
  const root = mkdtempSync(join(tmpdir(), 'lfclaw-share-expiry-'))
  const now = 1792100000000
  t.mock.method(Date, 'now', () => now)
  try {
    const shares = new SessionShares(root)
    assert.deepEqual(shares.policy(), { retentionDays: 30, maxBytes: 50 * 1024 * 1024 })
    shares.configure({ retentionDays: 1, maxBytes: 1024 })
    const payload = Buffer.from('{"version":1}')
    const share = shares.create({ id: 'a', name: '甲' }, '聊天', ['b'], payload)
    const path = join(root, `${share.id}.json`)
    assert.deepEqual(new SessionShares(root).download('b', share.id), payload)
    writeFileSync(path, 'damaged')
    assert.throws(() => shares.download('b', share.id), /校验失败/)
    writeFileSync(path, payload)
    t.mock.method(Date, 'now', () => now + 86400000)
    assert.equal(shares.download('b', share.id), 'expired')
    assert.equal(existsSync(path), false)
    assert.equal(shares.list('b')[0]?.expired, true)
    assert.equal(shares.list('b')[0]?.title, '聊天')
    t.mock.method(Date, 'now', () => now + 30 * 86400000)
    shares.cleanup()
    assert.deepEqual(shares.list('b'), [])
    writeFileSync(join(root, 'index.json'), '{"version":1}')
    assert.throws(() => shares.policy(), /索引损坏/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
