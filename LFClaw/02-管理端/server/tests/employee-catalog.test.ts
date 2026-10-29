/** 员工准备目录的实际 HTTP 载荷与即时撤权回归。 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { createApp } from '../src/app.ts'
import { activationHash, AuthService } from '../src/auth.ts'
import { JsonStore, type RecordItem } from '../src/store.ts'
import { skillArchiveLimits } from './skill-limits.ts'

async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'lfclaw-catalog-'))
  let server: Server | undefined
  t.after(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  const store = new JsonStore(join(root, 'db.json'))
  const icon = `data:image/png;base64,${'A'.repeat(1_500_000)}`
  store.update(db => {
    db.employees = [{ id: 'employee', name: 'Test', status: 'active', activationCode: 'test-code' }]
    db.models = Array.from({ length: 2 }, (_, i) => ({ id: `model-${i}`, name: `Model ${i}`, scope: 'all',
      type: 'text', protocol: 'openai-compatible', contextWindow: 32768, maxTokens: 4096, apiKey: 'never-return-this' }))
    db.skills = Array.from({ length: 12 }, (_, i) => ({ id: `skill-${i}`, name: `skill-${i}`, description: 'Synthetic skill',
      version: '1.0.0', sha256: 'a'.repeat(64), scope: 'all', icon }))
    db.connectors = Array.from({ length: 3 }, (_, i) => ({ id: `connector-${i}`, name: `Connector ${i}`, scope: 'all', icon }))
    db.models.push({ id: 'denied-model', scope: 'none' })
    db.skills.push({ id: 'denied-skill', scope: 'none' })
  })
  const auth = new AuthService(join(root, 'auth.json'), 'password-long-enough', { adminMs: 60000, employeeMs: 60000 })
  const token = auth.issue({ principal: 'employee', employeeId: 'employee', activationCodeHash: activationHash('test-code') })
  server = createApp({ store, auth, dataDirectory: root, skillsDirectory: join(root, 'skills'), skillArchiveLimits,
    allowedOrigin: '', modelTimeoutMs: 1000, authWindowMs: 1000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert(address && typeof address !== 'string')
  return { store, request: (path: string, authenticated = true) => fetch(`http://127.0.0.1:${address.port}/api/employee/${path}`, {
    headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
  }) }
}

test('准备目录不随图标体积增长，并保留完整目录的授权与容量信息', async t => {
  const { request } = await fixture(t)
  const samples: Record<string, Array<{ bytes: number; ms: number }>> = {}
  let full: { models: RecordItem[]; skills: RecordItem[] } | undefined
  for (const path of ['me', 'model-catalog', 'skill-catalog']) {
    samples[path] = []
    for (let i = 0; i < 3; i++) {
      const start = performance.now(), response = await request(path), text = await response.text()
      const elapsed = performance.now() - start
      assert.equal(response.status, 200)
      const body = JSON.parse(text)
      samples[path].push({ bytes: Buffer.byteLength(text), ms: Math.round(elapsed * 10) / 10 })
      if (path === 'me') { full = body; assert(Buffer.byteLength(text) > 18_000_000) }
      else {
        assert.equal(response.headers.get('cache-control'), 'private, no-store')
        assert(Buffer.byteLength(text) < 8192)
        assert(!text.includes('never-return-this'))
        assert(!text.includes('data:image'))
        assert(full)
        if (path === 'model-catalog') assert.deepEqual(body, { models: full.models })
        else assert.deepEqual(body, { employee: { id: 'employee' }, skills: full.skills.map(({ icon: _icon, ...skill }) => skill) })
      }
    }
  }
  t.diagnostic(JSON.stringify(samples))
  const display = await request('skill-catalog?icons=1')
  const body = await display.json() as { skills: RecordItem[] }
  assert.deepEqual(body.skills, full!.skills)
  assert.deepEqual(Object.keys(body).sort(), ['employee', 'skills'])
  assert.equal((await request('skill-catalog?icons=1', false)).status, 401)
  const connectorSummary = await request('connector-catalog?summary=1')
  const summaryText = await connectorSummary.text()
  assert(summaryText.length < 8192)
  const summary = JSON.parse(summaryText)
  const detailed = await (await request('connector-catalog')).json() as { revision: string; connectors: RecordItem[] }
  assert.equal(summary.revision, detailed.revision)
  assert.deepEqual(summary.connectors, detailed.connectors.map(item => ({ ...item, icon: '' })))
  assert.equal((await request('connector-catalog?summary=1', false)).status, 401)
})

test('准备目录每次重新验证身份和资源授权', async t => {
  const { store, request } = await fixture(t)
  for (const path of ['model-catalog', 'skill-catalog']) {
    const response = await request(path, false)
    assert.equal(response.status, 401); await response.text()
  }
  store.update(db => {
    db.models[0]!.employeeOverrides = { employee: 'deny' }
    db.skills[0]!.enabled = false
  })
  assert.equal((await (await request('model-catalog')).json() as { models: unknown[] }).models.length, 1)
  assert.equal((await (await request('skill-catalog')).json() as { skills: unknown[] }).skills.length, 11)
  store.update(db => { db.employees[0]!.status = 'disabled' })
  for (const path of ['model-catalog', 'skill-catalog']) {
    const response = await request(path)
    assert.equal(response.status, 401); await response.text()
  }
  store.update(db => { db.employees[0]!.status = 'active'; db.employees[0]!.activationCode = 'reset-code' })
  for (const path of ['model-catalog', 'skill-catalog']) {
    const response = await request(path)
    assert.equal(response.status, 401); await response.text()
  }
})
