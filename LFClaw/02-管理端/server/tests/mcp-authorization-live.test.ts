import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AuthService, activationHash } from '../src/auth.ts'
import { createApp } from '../src/app.ts'
import { JsonStore } from '../src/store.ts'
import { mallPermissionIds } from '../src/mcp.ts'
import { mallArgumentsAllowed, mallPublicResult, mallToolAllowed, resolveMallCalls } from '../src/mcp-policy.ts'

interface FixtureResponse {
  revision: string
  connectors: { dataPermissions: string[]; tools: { name: string }[] }[]
  tools: { inputSchema: { properties: Record<string, object>; required: string[] } }[]
  content: { text: string }[]
  code: string
}
const json = async (response: Response): Promise<FixtureResponse> => await response.json() as FixtureResponse

test('权限说明使用员工范围，错误和未知工具响应不改写', () => {
  const structuredContent = { success: true, info: '上游全场权限', data: { sales: 100 } }
  const result = { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent }
  const normalized = mallPublicResult('getFloorDimensionData', result, ['operation.floor.1'])
  assert.deepEqual(normalized.structuredContent, { ...structuredContent, info: '当前商场数据权限：一层。' })
  assert.deepEqual(JSON.parse(normalized.content[0]!.type === 'text' ? normalized.content[0]!.text : ''), normalized.structuredContent)
  assert.equal(mallPublicResult('unknown', result, mallPermissionIds), result)
  const error = { ...result, isError: true }
  assert.equal(mallPublicResult('getFloorDimensionData', error, ['operation.floor.1']), error)
  const failure = { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, info: '日期无效', data: null }) }] }
  assert.deepEqual(mallPublicResult('getFloorDimensionData', failure, ['operation.floor.1']), failure)
})

test('32 种楼层组合限制查询范围，淘气堡及未知工具仅完整授权可用', () => {
  const ids = ['1', '2', '3', '4', '565']
  for (let mask = 0; mask < 32; mask++) {
    const permissions = mallPermissionIds.filter((_permission, index) => mask & (1 << index))
    ids.forEach((floor, index) => {
      assert.equal(mallArgumentsAllowed('getFloorDimensionData', { floorIds: floor }, permissions), !!(mask & (1 << index)))
      assert.equal(mallArgumentsAllowed('getShopDimensionData', { floorId: Number(floor) }, permissions), !!(mask & (1 << index)))
      const region = floor === '565' ? floor : `${floor}-1`
      assert.equal(mallArgumentsAllowed('getRegionDimensionData', { floorIds: region }, permissions), !!(mask & (1 << index)))
    })
    for (const tool of ['getBusinessDimensionData', 'getProblemDimensionData', 'getBrandStatementData',
      'getGuiderOrderRate', 'getGuiderDimensionData', 'getReportDimensionData']) assert.equal(mallToolAllowed(tool, permissions), mask === 31)
    for (const tool of ['getQiqiliyaTqbSaleData', 'unknown']) assert.equal(mallToolAllowed(tool, permissions), mask === 31)
    assert.equal(mallArgumentsAllowed('getFloorDimensionData', { floorIds: '1,2,3,4,565' }, permissions), mask === 31)
    assert.equal(mallArgumentsAllowed('getFloorDimensionData', { floorIds: '1 OR 1=1' }, permissions), false)
    if (mask > 0 && mask < 31) {
      const authorizedIds = ids.filter((_floor, index) => mask & (1 << index))
      const floorCalls = resolveMallCalls('getFloorDimensionData', {}, permissions)
      assert.deepEqual(floorCalls.map(args => args.floorIds), authorizedIds)
      assert.deepEqual(resolveMallCalls('getShopDimensionData', {}, permissions).map(args => String(args.floorId)), authorizedIds)
      const regions = authorizedIds.map(floor => floor === '565' ? floor : `${floor}-1`)
      assert.deepEqual(resolveMallCalls('getRegionDimensionData', { floorIds: regions.join(',') }, permissions)
        .map(args => args.floorIds), regions)
      assert(floorCalls.every(args => args.openId === '' && args.appId === '' && args.appSecret === ''))
    }
  }
})

test('无需签名的 HTTP/SSE 对接覆盖范围限制、改权、旧响应失效及长轮询通知', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-mcp-live-'))
  const streams = new Map<string, ServerResponse>()
  let serial = 0
  let hold: (() => void) | undefined
  let called: (() => void) | undefined
  let calls = 0
  const mall = createServer(async (req, res) => {
    if (req.url === '/sse2') {
      const id = String(++serial)
      streams.set(id, res)
      res.on('close', () => streams.delete(id))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`event: endpoint\ndata: /mcp2/message?sessionId=${id}\n\n`)
      return
    }
    assert.equal(req.headers['x-lfclaw-permission-assertion'], undefined)
    const parts: Buffer[] = []
    for await (const part of req) parts.push(Buffer.from(part))
    const message = JSON.parse(Buffer.concat(parts).toString()) as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } }
    const stream = streams.get(new URL(req.url!, 'http://localhost').searchParams.get('sessionId')!)
    res.writeHead(202).end()
    if (message.id === undefined) return
    const send = (result: object) => stream?.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
    if (message.method === 'initialize') send({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'DBC MCP Server', version: '1' } })
    else if (message.method === 'tools/list') send({ tools: ['getFloorDimensionData', 'getBusinessDimensionData', 'getQiqiliyaTqbSaleData', 'futureTool', 'getShopDimensionData', 'getRegionDimensionData'].map(name => ({
      name, inputSchema: { type: 'object', properties: { floorIds: { type: 'string' }, openId: { type: 'string' }, appId: { type: 'string' }, appSecret: { type: 'string' } }, required: ['floorIds', 'openId'] },
    })) })
    else if (message.method === 'tools/call') {
      calls++
      const args = message.params!.arguments
      assert.equal(args.openId, '')
      assert.equal(args.appId, '')
      assert.equal(args.appSecret, '')
      const scope = String(args.floorIds ?? args.floorId ?? 'ALL')
      const reply = () => send({ content: [{ type: 'text', text: scope }] })
      if (called) { hold = reply; called(); called = undefined } else reply()
    }
  })
  mall.listen(0, '127.0.0.1')
  await once(mall, 'listening')
  const mallAddress = mall.address()
  assert(mallAddress && typeof mallAddress !== 'string')
  const store = new JsonStore(join(directory, 'db.json'))
  store.update(db => {
    db.employees.push({ id: 'e1', name: '测试员工', status: 'active', activationCode: 'fixture-code', departmentId: 'floor1', mcpPermissions: ['operation.floor.1'] })
    db.departments.push({ id: 'floor1', floor: '1F' })
    db.connectors.push({ id: 'mall', name: '商场', type: 'mcp', endpoint: `http://127.0.0.1:${mallAddress.port}/sse2`, transport: 'sse',
      mallDataPermissions: true, enabled: true, scope: 'all', tools: ['getFloorDimensionData', 'getBusinessDimensionData', 'getQiqiliyaTqbSaleData', 'futureTool', 'getShopDimensionData', 'getRegionDimensionData'].map(name => ({ id: name, name, allowed: true })) })
  })
  const auth = new AuthService(join(directory, 'auth.json'), 'fixture-admin-password', { adminMs: 60_000, employeeMs: 60_000 })
  const admin = auth.login('admin', 'fixture-admin-password')!
  const employee = auth.issue({ principal: 'employee', employeeId: 'e1', activationCodeHash: activationHash('fixture-code') })
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'), allowedOrigin: 'http://localhost',
    mcpTimeoutMs: 2000, modelTimeoutMs: 2000, authWindowMs: 60_000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const request = (path: string, body?: object, token = employee, method = 'POST') => fetch(`http://127.0.0.1:${address.port}/api/${path}`, {
    method: body ? method : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const change = (permissions: string[] | null) => request('admin/employees/e1/mcp-permissions', { permissions }, admin, 'PUT')
  const call = (floorIds: string, name = 'getFloorDimensionData') => request('employee/connectors/mall/call', { name,
    arguments: { floorIds, openId: '', appId: 'forged', appSecret: 'forged', permissions: [...mallPermissionIds] } })
  try {
    await t.test('客户端只能看到允许工具，身份字段不进入模型参数', async () => {
      const catalog = await json(await request('employee/connector-catalog'))
      assert.deepEqual(catalog.connectors[0].dataPermissions, ['operation.floor.1'])
      assert.deepEqual(catalog.connectors[0].tools.map((tool: { name: string }) => tool.name), ['getFloorDimensionData', 'getShopDimensionData', 'getRegionDimensionData'])
      const tools = await json(await request('employee/connectors/mall/tools'))
      assert.deepEqual(Object.keys(tools.tools[0].inputSchema.properties), ['floorIds'])
      assert.deepEqual(tools.tools[0].inputSchema.required, ['floorIds'])
      assert.equal((await call('2')).status, 403)
      assert.equal((await call('1', 'getBusinessDimensionData')).status, 403)
      assert.equal(calls, 0)
      const partial = await json(await call('1,2'))
      assert.equal(partial.content[0].text, '1')
      assert.match(partial.content[1].text, /二层未授权/u)
      assert.equal(calls, 1)
      const result = await call('1')
      assert.equal(result.status, 200)
      assert.deepEqual((await json(result)).content[0].text, '1')
    })
    await t.test('改权唤醒客户端长轮询，已有令牌立刻使用新范围，空范围拒绝调用', async () => {
      const original = await json(await request('employee/connector-catalog'))
      const waiting = request(`employee/connector-catalog?revision=${original.revision}`)
      assert.equal((await change(['operation.floor.2'])).status, 200)
      const updated = await json(await waiting)
      assert.notEqual(updated.revision, original.revision)
      assert.deepEqual(updated.connectors[0].dataPermissions, ['operation.floor.2'])
      assert.equal((await call('1')).status, 403)
      assert.deepEqual((await json(await call('2'))).content[0].text, '2')
      await change([])
      assert.equal((await call('2')).status, 403)
      assert.deepEqual((await json(await request('employee/connector-catalog'))).connectors[0].tools, [])
    })
    await t.test('完整权限可以调用淘气堡和未知工具，仍须具有工具授权', async () => {
      await change(['operation.floor.1'])
      assert.equal((await call('1', 'getQiqiliyaTqbSaleData')).status, 403)
      assert.equal((await call('1', 'futureTool')).status, 403)
      await change([...mallPermissionIds])
      assert.equal((await call('1', 'getQiqiliyaTqbSaleData')).status, 200)
      assert.equal((await call('1', 'futureTool')).status, 200)
      store.update(db => { db.connectors[0]!.tools = [{ id: 'floor', name: 'getFloorDimensionData', allowed: true }] })
      assert.equal((await call('1', 'futureTool')).status, 403)
      await change([])
      assert.equal((await call('1')).status, 403)
    })
    await t.test('部分权限按单楼层请求，省略店铺楼层不会查询全场', async () => {
      store.update(db => { db.connectors[0]!.tools = ['getFloorDimensionData', 'getRegionDimensionData', 'getShopDimensionData']
        .map(name => ({ id: name, name, allowed: true })) })
      await change(['operation.floor.1', 'operation.floor.2', 'operation.floor.3', 'operation.floor.4'])
      const floors = await json(await call('1,2,3,4'))
      assert.deepEqual(floors.content.map(item => item.text), ['1', '2', '3', '4'])
      const shops = await request('employee/connectors/mall/call', { name: 'getShopDimensionData', arguments: { openId: 'forged' } })
      assert.deepEqual((await json(shops)).content.map(item => item.text), ['1', '2', '3', '4'])
      const regions = await json(await call('1-1,1-2,2-1', 'getRegionDimensionData'))
      assert.deepEqual(regions.content.map(item => item.text), ['1-1,1-2', '2-1'])
      const partial = await json(await call('1,565'))
      assert.equal(partial.content[0].text, '1')
      assert.match(partial.content[1].text, /自营未授权/u)
      const partialRegions = await json(await call('1-1,565', 'getRegionDimensionData'))
      assert.equal(partialRegions.content[0].text, '1-1')
      assert.match(partialRegions.content[1].text, /自营未授权/u)
    })
    await t.test('查询中改权后再恢复旧权限也不能返回旧结果', async () => {
      await change(['operation.floor.1'])
      const reached = new Promise<void>(resolve => { called = resolve })
      const pending = call('1')
      await reached
      await change(['operation.floor.2'])
      await change(['operation.floor.1'])
      hold?.()
      const rejected = await pending
      assert.equal(rejected.status, 403)
      assert.equal((await json(rejected)).code, 'CONNECTOR_ACCESS_CHANGED')
    })
    await t.test('部门修改不改变个人范围，停用立即撤权，普通模式不能调用商场服务', async () => {
      assert.equal((await change(null)).status, 400)
      await change(['operation.floor.3'])
      store.update(db => { db.departments[0]!.floor = '3F' })
      assert.equal((await call('1')).status, 403)
      assert.deepEqual((await json(await call('3'))).content[0].text, '3')
      store.update(db => { db.departments[0]!.floor = '1F'; db.departments[0]!.selfOperated = true })
      assert.equal((await call('1')).status, 403)
      assert.deepEqual((await json(await call('3'))).content[0].text, '3')
      store.update(db => { db.connectors[0]!.mallDataPermissions = false })
      assert.equal((await call('3')).status, 502)
      store.update(db => { db.employees[0]!.status = 'inactive' })
      assert.equal((await request('employee/connector-catalog')).status, 401)
    })
  } finally {
    for (const stream of streams.values()) stream.end()
    server.closeAllConnections(); server.close(); await once(server, 'close')
    mall.closeAllConnections(); mall.close(); await once(mall, 'close')
    rmSync(directory, { recursive: true, force: true })
  }
})
