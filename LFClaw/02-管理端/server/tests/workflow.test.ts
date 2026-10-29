/** 使用隔离数据验证企业工作流 HTTP 权限与完整交接。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createApp } from '../src/app.ts'
import { AuthService, activationHash } from '../src/auth.ts'
import { JsonStore } from '../src/store.ts'
import { type WorkItem, validWorkItems } from '../src/workflow.ts'
import { skillArchiveLimits } from './skill-limits.ts'

test('部门内和跨部门流转：退回、转交、补充、变更确认、版本验收与只读管理', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lfclaw-workflow-')), store = new JsonStore(join(root, 'db.json'))
  const people = ['creator', 'worker', 'reviewer', 'next', 'copy', 'stranger']
  store.update(db => {
    db.departments = [{ id: 'a', name: '营运部' }, { id: 'b', name: '营销部' }]
    db.employees = people.map((id, i) => ({ id, name: id, departmentId: i === 0 ? 'a' : 'b', status: 'active', activationCode: `code-${id}` }))
  })
  const auth = new AuthService(join(root, 'auth.json'), 'password-long-enough', { adminMs: 60000, employeeMs: 60000 })
  const tokens = Object.fromEntries(people.map(employeeId => [employeeId, auth.issue({ principal: 'employee', employeeId, activationCodeHash: activationHash(`code-${employeeId}`) })]))
  tokens.admin = auth.issue({ principal: 'admin' })
  const app = createApp({ store, auth, dataDirectory: root, skillsDirectory: join(root, 'skills'), skillArchiveLimits,
    allowedOrigin: '', modelTimeoutMs: 1000, authWindowMs: 1000, loginMaxFailures: 3, activationMaxFailures: 3 })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert(address && typeof address !== 'string')
  const port = address.port
  async function request(actor: string, path = '/employee/workflows', body?: object, method?: string) {
    return fetch(`http://127.0.0.1:${port}/api${path}`, { method: method ?? (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[actor] ?? ''}` }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  const creation = { action: 'create', operationId: randomUUID(), title: '会员活动海报', original: '需要线上线下海报', summary: '待确认尺寸', requirement: '交付 A3 印刷稿，文字完整',
    assignee: 'worker', reviewer: 'reviewer', cc: ['copy'], deadline: '2030-10-25T09:00:00Z', artifacts: [] }
  try {
    assert.equal((await request('admin')).status, 401)
    assert.equal((await request('stranger', '/admin/workflows')).status, 401)
    assert.equal((await request('creator', '/employee/workflows', { ...creation, assignee: 'missing' })).status, 400)
    let w = await (await request('creator', '/employee/workflows', creation)).json() as WorkItem
    assert.equal(w.status, 'processing')
    assert.equal((await (await request('creator', '/employee/workflows', creation)).json() as WorkItem).id, w.id)
    assert.equal(store.read().workflows.length, 1)
    assert.equal((await (await request('copy')).json() as { items: Array<WorkItem & { resultOnly: boolean }> }).items.length, 0)
    assert.equal((await (await request('stranger')).json() as { items: Array<WorkItem & { resultOnly: boolean }> }).items.length, 0)
    const command = (action: string, extra: object = {}) => ({ id: w.id, revision: w.revision, action, operationId: randomUUID(), original: `说明 ${action}`, summary: '交接摘要', artifacts: [], ...extra })
    assert.equal((await request('creator', '/employee/workflows', command('approve'))).status, 403)
    assert.equal((await request('stranger', '/employee/workflows', command('transfer', { target: 'stranger' }))).status, 404)
    assert.equal((await request('worker', '/employee/workflows', command('submit', { revision: 0 }))).status, 409)
    const stale = command('submit')
    async function step(actor: string, action: string, extra: object = {}) {
      const response = await request(actor, '/employee/workflows', command(action, extra))
      assert.equal(response.status, 200, await response.clone().text()); w = await response.json() as WorkItem
    }
    await step('worker', 'ask'); assert.equal(w.assignee, 'creator')
    await step('creator', 'supplement'); assert.equal(w.assignee, 'worker')
    assert.equal((await request('worker', '/employee/workflows', stale)).status, 409)
    await step('creator', 'change', { requirement: '改为 A4，确认印刷稿', deadline: '2030-10-26T09:00:00Z' })
    assert.equal(w.status, 'confirmation')
    assert.equal((await request('worker', '/employee/workflows', command('submit'))).status, 403)
    await step('worker', 'accept')
    await step('worker', 'transfer', { target: 'next' })
    assert.equal((await request('worker', '/employee/workflows', command('submit'))).status, 403)
    await step('next', 'submit', { artifacts: [{ name: 'V1', url: 'https://example.com/v1.pdf' }] })
    await step('reviewer', 'return'); assert.equal(w.assignee, 'next')
    const file = { name: '最终.txt', url: `data:application/octet-stream;base64,${Buffer.from('最终产物').toString('base64')}` }
    await step('next', 'submit', { artifacts: [file] })
    const approval = command('approve')
    w = await (await request('reviewer', '/employee/workflows', approval)).json() as WorkItem
    assert.equal(w.status, 'completed'); assert(validWorkItems([w]))
    assert.equal((await request('reviewer', '/employee/workflows', approval)).status, 200)
    const copied = (await (await request('copy')).json() as { items: Array<WorkItem & { resultOnly: boolean }> }).items[0]
    assert.equal(copied.resultOnly, true); assert.equal(copied.requirement, undefined)
    assert.equal(copied.history.length, 2); assert.deepEqual(copied.history[0].artifacts, [file])
    assert.equal(JSON.stringify(copied).includes('https://example.com/v1.pdf'), false)
    assert.equal((await request('copy', '/employee/workflows', command('cancel'))).status, 404)
    assert.equal((await request('creator', '/employee/workflows', command('cancel'))).status, 409)
    const admin = await (await request('admin', '/admin/workflows')).json() as Array<{ creator: { department: string }; history?: unknown; requirement?: unknown }>
    assert.equal(admin.length, 1); assert.equal(admin[0].creator.department, '营运部')
    assert.equal(admin[0].history, undefined); assert.equal(admin[0].requirement, undefined)
    assert.equal((await (await request('admin', '/admin/data')).json() as { workflows?: unknown }).workflows, undefined)
    assert.notEqual((await request('admin', '/admin/workflows', command('cancel'))).status, 200)
    assert.equal(new JsonStore(store.path).read().workflows[0]?.history.length, w.history.length)
    store.update(db => { db.employees.find(e => e.id === 'next')!.status = 'inactive' })
    assert.equal((await request('next')).status, 401)
    const bad = await request('creator', '/employee/workflows', { ...creation, operationId: randomUUID(), artifacts: [{ name: 'x', url: 'javascript:alert(1)' }] })
    assert.equal(bad.status, 400)
    assert.equal((await request('creator', '/employee/workflows/summary', { original: '请整理需求' })).status, 503)
    const cancelled = await (await request('creator', '/employee/workflows', { ...creation, operationId: randomUUID() })).json() as WorkItem
    w = cancelled; await step('creator', 'cancel'); assert.equal(w.status, 'cancelled')
    const before = readFileSync(store.path, 'utf8'), broken = JSON.parse(before)
    broken.workflows[0].history[0].artifacts = [{ name: 'bad', url: 'file:///secret' }]
    writeFileSync(store.path, JSON.stringify(broken))
    assert.throws(() => store.read(), /工作流记录损坏/)
    assert.equal(readFileSync(store.path, 'utf8'), JSON.stringify(broken))
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); rmSync(root, { recursive: true, force: true }) }
})
