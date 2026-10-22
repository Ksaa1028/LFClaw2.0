import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withMcp } from '../src/mcp.ts'

const endpoint = process.env.LFCLAW_MALL_LIVE_URL

test('现有商场 SSE 无需权限签名即可连接并读取工具目录（不查询业务数据）',
  { skip: !endpoint, timeout: 15000 }, async () => {
    assert(endpoint)
    const result = await withMcp({ endpoint, transport: 'sse', headers: {}, timeoutMs: 10000 },
      client => client.listTools())
    const names = new Set(result.tools.map(tool => tool.name))
    for (const name of ['getFloorDimensionData', 'getRegionDimensionData', 'getShopDimensionData', 'getQiqiliyaTqbSaleData']) {
      assert(names.has(name), `missing expected tool: ${name}`)
    }
  })
