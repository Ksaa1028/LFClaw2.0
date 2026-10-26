/** 输入框轻量目录通过真实 HTTP 保持资源授权与响应体积。 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createApp } from '../src/app.ts'
import { activationHash, AuthService } from '../src/auth.ts'
import { JsonStore } from '../src/store.ts'
import { skillArchiveLimits } from './skill-limits.ts'

const paths = ['identity', 'expert-picker', 'connector-picker'] as const

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-composer-catalog-'))
  let server: Server | undefined
  t.after(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  const store = new JsonStore(join(directory, 'db.json'))
  store.update(db => {
    db.employees = [{ id: 'employee', name: 'Test', status: 'active', activationCode: 'test-code' }]
    db.experts = [
      { id: 'a', name: 'Analyst', description: 'Analysis', source: 'dsh', instructions: 'never-return-instructions', scope: 'all' },
      { id: 'b', name: 'Remote', description: 'Remote expert', source: 'bailian', apiKey: 'never-return-secret', scope: 'all' },
      { id: 'team', name: 'Team', description: 'Work together', source: 'team', memberIds: ['a', 'b'], scope: 'all' },
      { id: 'denied', name: 'Denied', source: 'dsh', scope: 'none' },
      { id: 'denied-team', name: 'Denied team', source: 'team', memberIds: ['a', 'denied'], scope: 'all' },
    ]
    db.personalExperts = [
      { id: 'personal', name: 'My expert', description: 'Personal', kind: 'expert', ownerEmployeeId: 'employee', instructions: 'never-return-personal' },
      { id: 'personal-2', name: 'My reviewer', description: 'Review', kind: 'expert', ownerEmployeeId: 'employee' },
      { id: 'personal-team', name: 'My team', description: 'Personal team', kind: 'team', ownerEmployeeId: 'employee', memberIds: ['personal', 'personal-2'] },
      { id: 'other', name: 'Other employee', description: 'Private', kind: 'expert', ownerEmployeeId: 'another', instructions: 'never-return-other' },
    ]
    db.connectors = [
      { id: 'ready', name: 'Ready', scope: 'all', tools: [{ id: 'read', name: 'read', description: 'Read', allowed: true }] },
      { id: 'off', name: 'Tools disabled', scope: 'all', mallDataPermissions: true, tools: [{ id: 'off', name: 'off', allowed: false }] },
      { id: 'account', name: 'Account required', scope: 'all', transport: 'stdio', employeeCredentials: 'wechat-mp',
        tools: [{ id: 'account-read', name: 'read', allowed: true }] },
      { id: 'denied', name: 'Denied connector', scope: 'none', tools: [{ id: 'hidden', name: 'hidden', allowed: true }] },
    ]
  })
  const auth = new AuthService(join(directory, 'auth.json'), 'password-long-enough', { adminMs: 60000, employeeMs: 60000 })
  const token = auth.issue({ principal: 'employee', employeeId: 'employee', activationCodeHash: activationHash('test-code') })
  server = createApp({ store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'), skillArchiveLimits,
    allowedOrigin: '', modelTimeoutMs: 1000, authWindowMs: 1000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert(address && typeof address !== 'string')
  return { store, request: (path: string, authenticated = true) => fetch(`http://127.0.0.1:${address.port}/api/employee/${path}`, {
    headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
  }) }
}

test('输入框目录只包含显示字段、当前所有权和可用性，不随图标和指令增长', async t => {
  const { store, request } = await fixture(t)
  const before = new Map<string, string>()
  for (const path of paths) {
    const response = await request(path)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    before.set(path, await response.text())
  }
  assert.deepEqual(JSON.parse(before.get('identity')!), { employee: { id: 'employee' } })
  assert.deepEqual(JSON.parse(before.get('expert-picker')!), {
    experts: [
      { id: 'a', name: 'Analyst', description: 'Analysis', source: 'dsh' },
      { id: 'b', name: 'Remote', description: 'Remote expert', source: 'bailian' },
      { id: 'team', name: 'Team', description: 'Work together', source: 'team' },
    ],
    personalExperts: [
      { id: 'personal', name: 'My expert', description: 'Personal', kind: 'expert' },
      { id: 'personal-2', name: 'My reviewer', description: 'Review', kind: 'expert' },
      { id: 'personal-team', name: 'My team', description: 'Personal team', kind: 'team' },
    ],
  })
  assert.deepEqual(JSON.parse(before.get('connector-picker')!), {
    connectors: [
      { id: 'ready', name: 'Ready', hasAvailableTools: true },
      { id: 'off', name: 'Tools disabled', hasAvailableTools: false },
      { id: 'account', name: 'Account required', hasAvailableTools: false },
    ],
  })
  store.update(db => {
    const icon = `data:image/png;base64,${'A'.repeat(1_500_000)}`
    for (const connector of db.connectors) { connector.icon = icon; connector.headers = { Authorization: 'never-return-secret' } }
    for (const expert of [...db.experts, ...db.personalExperts]) expert.instructions = 'never-return-long-instructions'.repeat(50000)
    db.skills = [{ id: 'large-skill', name: 'Unrelated', scope: 'all', icon }]
    db.notifications = [{ id: 'notice', content: 'never-return-announcement'.repeat(50000) }]
  })
  const samples = []
  for (const path of paths) {
    const start = performance.now(), response = await request(path), text = await response.text()
    assert.equal(response.status, 200)
    assert.equal(text, before.get(path))
    assert(Buffer.byteLength(text) < 2048)
    assert.doesNotMatch(text, /never-return|data:image|instructions|Authorization/)
    samples.push({ path, bytes: Buffer.byteLength(text), ms: Math.round((performance.now() - start) * 10) / 10 })
  }
  t.diagnostic(JSON.stringify(samples))
})

test('输入框目录即时反映工具停用、专家撤权和专家团成员撤权', async t => {
  const { store, request } = await fixture(t)
  store.update(db => {
    db.experts[0]!.employeeOverrides = { employee: 'deny' }
    db.connectors[0]!.tools = []
    db.connectors[1]!.enabled = false
  })
  const experts = await (await request('expert-picker')).json() as { experts: Array<{ id: string }> }
  assert.deepEqual(experts.experts.map(expert => expert.id), ['b'])
  assert.deepEqual(await (await request('connector-picker')).json(), {
    connectors: [
      { id: 'ready', name: 'Ready', hasAvailableTools: false },
      { id: 'account', name: 'Account required', hasAvailableTools: false },
    ],
  })
})

test('输入框目录拒绝缺失身份、停用员工和已重置激活码', async t => {
  const { store, request } = await fixture(t)
  for (const path of paths) {
    const response = await request(path, false)
    assert.equal(response.status, 401); await response.text()
  }
  store.update(db => { db.employees[0]!.status = 'disabled' })
  for (const path of paths) {
    const response = await request(path)
    assert.equal(response.status, 401); await response.text()
  }
  store.update(db => { db.employees[0]!.status = 'active'; db.employees[0]!.activationCode = 'reset-code' })
  for (const path of paths) {
    const response = await request(path)
    assert.equal(response.status, 401); await response.text()
  }
})
