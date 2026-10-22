import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthService } from '../src/auth.ts'
import { createApp } from '../src/app.ts'
import { JsonStore } from '../src/store.ts'

test('商场开关独立于名称、地址、传输和 Header；无需签名配置，连接失败不保存，调用限定员工楼层', async () => {
  let unavailable = false
  let dataCalls = 0
  const mall = createServer(async (req, res) => {
    assert.equal(req.headers['x-api-key'], 'fixture-header')
    assert.equal(req.headers['x-lfclaw-permission-assertion'], undefined)
    if (unavailable) { res.writeHead(503).end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    if (chunks.length === 0) { res.writeHead(405).end(); return }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: number; method: string; params: { arguments: Record<string, unknown> } }
    if (message.id === undefined) { res.writeHead(202).end(); return }
    let result: object
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1.0.0' } }
    else if (message.method === 'tools/list') result = { tools: [{ name: 'getFloorDimensionData', inputSchema: { type: 'object' } }] }
    else {
      dataCalls += 1
      const args = message.params.arguments
      assert.equal(args.openId, '')
      assert.equal(args.appId, '')
      assert.equal(args.appSecret, '')
      assert(['1', '2'].includes(String(args.floorIds)))
      result = { content: [{ type: 'text', text: JSON.stringify({ success: true, info: '您拥有的权限有（一层、二层、三层、四层、自营）', data: { floorId: String(args.floorIds) } }) }] }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  mall.listen(0, '127.0.0.1')
  await once(mall, 'listening')
  const mallAddress = mall.address()
  assert(mallAddress && typeof mallAddress !== 'string')
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-permission-switch-'))
  const store = new JsonStore(join(directory, 'db.json'))
  store.update(db => { db.employees.push({ id: 'e1', name: '员工', status: 'active', activationCode: 'fixture-code',
    mcpPermissions: ['operation.floor.1', 'operation.floor.2'] }) })
  const auth = new AuthService(join(directory, 'admin-auth.json'), 'fixture-admin-password',
    { adminMs: 60_000, employeeMs: 60_000 })
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'),
    allowedOrigin: 'http://127.0.0.1:5173', mcpTimeoutMs: 2000,
    modelTimeoutMs: 2000, authWindowMs: 60_000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const adminToken = auth.login('admin', 'fixture-admin-password')!
    const request = (path: string, method: string, body: object, token = adminToken) =>
      fetch(`http://127.0.0.1:${address.port}/api${path}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const connector = { id: 'mall', name: '任意名称', endpoint: `http://127.0.0.1:${mallAddress.port}/custom-mcp`,
      transport: 'streamable-http', headers: { 'X-API-Key': 'fixture-header' }, mallDataPermissions: true,
      enabled: true, scope: 'all', scopeTarget: [], tools: [{ id: 'getFloorDimensionData', name: 'getFloorDimensionData', allowed: true }] }
    unavailable = true
    assert.equal((await request('/admin/data/connectors', 'POST', connector)).status, 502)
    assert.equal(store.read().connectors.length, 0)
    assert.equal(dataCalls, 0)
    unavailable = false
    const created = await request('/admin/data/connectors', 'POST', connector)
    assert.equal(created.status, 201)
    const published = await created.json() as { mallDataPermissions: boolean; headers: Record<string, string> }
    assert.equal(published.mallDataPermissions, true)
    assert.deepEqual(published.headers, { 'X-API-Key': '' })
    const changed = { ...connector, name: '线上改名', endpoint: `http://127.0.0.1:${mallAddress.port}/another-mcp` }
    assert.equal((await request('/admin/data/connectors/mall', 'PUT', changed)).status, 200)
    assert.equal(store.read().connectors[0]?.mallDataPermissions, true)
    const activation = await request('/employee/activate', 'POST', { code: 'fixture-code' })
    const employeeToken = (await activation.json() as { token: string }).token
    const call = await request('/employee/connectors/mall/call', 'POST', { name: 'getFloorDimensionData', arguments: {} }, employeeToken)
    assert.equal(call.status, 200)
    const output = await call.json() as { content: Array<{ text: string }> }
    assert.deepEqual(output.content.map(item => JSON.parse(item.text)), ['1', '2'].map(floorId => ({
      success: true, info: '当前商场数据权限：一层、二层。', data: { floorId },
    })))
    const mixed = await request('/employee/connectors/mall/call', 'POST', {
      name: 'getFloorDimensionData', arguments: { floorIds: '1,2,3,4,565' },
    }, employeeToken)
    assert.equal(mixed.status, 200)
    const partial = await mixed.json() as { content: Array<{ text: string }> }
    assert.deepEqual(partial.content.slice(0, 2).map(item => JSON.parse(item.text).data.floorId), ['1', '2'])
    assert.match(partial.content[2]!.text, /三层、四层、自营未授权/u)
    for (const floorIds of ['3', '3,4', '1,999', '1,,2']) {
      assert.equal((await request('/employee/connectors/mall/call', 'POST', {
        name: 'getFloorDimensionData', arguments: { floorIds },
      }, employeeToken)).status, 403)
    }
    unavailable = true
    assert.equal((await request('/employee/connectors/mall/call', 'POST', { name: 'getFloorDimensionData', arguments: {} }, employeeToken)).status, 502)
    assert.equal(dataCalls, 4)
    assert.equal((await request('/admin/data/connectors/mall', 'PUT', { ...changed, mallDataPermissions: false })).status, 200)
    assert.equal(store.read().connectors[0]?.mallDataPermissions, false)
  } finally {
    server.closeAllConnections(); server.close(); await once(server, 'close')
    mall.closeAllConnections(); mall.close(); await once(mall, 'close')
    rmSync(directory, { recursive: true, force: true })
  }
})
