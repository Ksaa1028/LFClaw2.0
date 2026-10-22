import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { JsonStore } from '../src/store.ts'
import { permissionsForEmployee, withMcp } from '../src/mcp.ts'

test('通用 Streamable HTTP MCP 将自定义 Header 用于连接及工具目录', async () => {
  const seen: string[] = []
  const server = createServer(async (req, res) => {
    seen.push(String(req.headers.authorization ?? ''))
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    if (chunks.length === 0) { res.writeHead(405).end(); return }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: number; method: string }
    if (message.method === 'notifications/initialized') { res.writeHead(202).end(); return }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
      : { tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }] }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const tools = await withMcp({ endpoint: `http://127.0.0.1:${address.port}/mcp`,
      transport: 'streamable-http', headers: { Authorization: 'Bearer fixture' }, timeoutMs: 2000 },
    client => client.listTools())
    assert.equal(tools.tools[0]?.name, 'lookup')
    assert(seen.length >= 2)
    assert(seen.every(value => value === 'Bearer fixture'))
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close') }
})

test('通用 SSE MCP 将自定义 Header 用于事件流和消息请求', async () => {
  const seen: string[] = []
  let stream: import('node:http').ServerResponse | undefined
  const server = createServer(async (req, res) => {
    seen.push(String(req.headers['x-api-key'] ?? ''))
    if (req.url === '/sse') {
      stream = res
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write('event: endpoint\ndata: /messages\n\n')
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: number; method: string }
    res.writeHead(202).end()
    if (message.id === undefined) return
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
      : { tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }] }
    stream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const tools = await withMcp({ endpoint: `http://127.0.0.1:${address.port}/sse`,
      transport: 'sse', headers: { 'X-API-Key': 'fixture-secret' }, timeoutMs: 2000 },
    client => client.listTools())
    assert.equal(tools.tools[0]?.name, 'lookup')
    assert(seen.length >= 3)
    assert(seen.every(value => value === 'fixture-secret'))
  } finally { stream?.end(); server.closeAllConnections(); server.close(); await once(server, 'close') }
})

test('商场权限仅按员工多选组合授权，部门变化不影响结果', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-mcp-test-'))
  const db = new JsonStore(join(directory, 'db.json')).read()
  db.departments.push({ id: 'root', floor: '1F', parentId: null }, { id: 'self', parentId: 'root', selfOperated: true })
  const permissions = permissionsForEmployee(db, { id: 'employee', departmentId: 'self' })
  assert.deepEqual(permissions, [])
  assert.deepEqual(permissionsForEmployee(db, { id: 'outsider', departmentId: 'missing' }), [])
  const allFive = [
    'operation.floor.1', 'operation.floor.2', 'operation.floor.3',
    'operation.floor.4', 'operation.self_operated',
  ]
  for (let mask = 0; mask < 32; mask++) {
    const selected = allFive.filter((_value, index) => (mask & (1 << index)) !== 0)
    for (const departmentId of ['self', 'root', 'missing']) {
      assert.deepEqual(permissionsForEmployee(db, { id: 'employee', departmentId, mcpPermissions: selected }), selected)
    }
  }
  assert.deepEqual(permissionsForEmployee(db, { id: 'employee', mcpPermissions: null }), [])
  assert.deepEqual(permissionsForEmployee(db, { id: 'employee', departmentId: 'self', mcpPermissions: allFive }), allFive)
  assert.deepEqual(permissionsForEmployee(db, { id: 'employee', departmentId: 'self', mcpPermissions: [] }), [])
  assert.deepEqual(permissionsForEmployee(db, { id: 'employee', departmentId: 'self', mcpPermissions: 'invalid' }), [])
  for (let mask = 0; mask < 32; mask++) {
    const selected = allFive.filter((_value, index) => (mask & (1 << index)) !== 0)
    for (const departmentId of ['self', 'root', 'missing']) {
      assert.deepEqual(permissionsForEmployee(db, { id: 'employee', departmentId, mcpPermissions: selected }), selected)
    }
  }
  assert.deepEqual(permissionsForEmployee(db, { id: 'employee', mcpPermissions: null }), [])
  rmSync(directory, { recursive: true, force: true })
})
