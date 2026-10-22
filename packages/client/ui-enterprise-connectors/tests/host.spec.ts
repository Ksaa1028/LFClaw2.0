import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { withCatalogWatch } from './watch-fixture.ts'
import { mountEnterpriseTools } from '../src/tools.ts'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const personalConfig = () => ({
  dataDirectory: join(tmpdir(), `lfclaw-connectors-${randomUUID()}`),
  requestTimeoutMs: 2000,
  maxConfigBytes: 65536,
})

it('proxies employee account writes without accepting an owner id or returning credentials', async () => {
  const ctx = new Context()
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  const { request } = withCatalogWatch(async path =>
    path.endsWith('/account')
      ? Response.json({ configured: true, appSecret: 'must-not-return' })
      : path.endsWith('/credentials')
        ? Response.json({ code: 'OAUTH_CALLBACK_UNAVAILABLE', internal: 'must-not-return' }, { status: 503 })
        : Response.json({ employee: { id: 'employee' }, connectors: [] }),
  )
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: { value: { register: () => () => {} } },
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
      },
    },
  })
  apply(ctx, { refreshIntervalMs: 30000, ...personalConfig() })
  try {
    const route = routes.get('/api/lfclaw/connector-account')!
    const send = (body: object) =>
      route.fetch(
        new Request('http://localhost/api/lfclaw/connector-account?id=wechat', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      )
    expect((await send({ operation: 'save', appId: 'id', appSecret: 'secret', employeeId: 'someone-else' })).status).toBe(400)
    const result = await send({ operation: 'save', appId: 'id', appSecret: 'secret' })
    expect(await result.json()).toEqual({ configured: true })
    expect(request).toHaveBeenCalledWith(
      'employee/connectors/wechat/account',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ appId: 'id', appSecret: 'secret' }),
      }),
    )
    const unavailable = await routes
      .get('/api/lfclaw/connector-credentials')!
      .fetch(
        new Request('http://localhost/api/lfclaw/connector-credentials?id=notion', {
          method: 'POST',
          body: JSON.stringify({ operation: 'oauth', configuration: 'fixture' }),
        }),
      )
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ code: 'OAUTH_CALLBACK_UNAVAILABLE' })
  } finally {
    await ctx.fiber.dispose()
  }
  expect(routes.size).toBe(0)
})

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, execution: { signal: AbortSignal }) => Promise<unknown>
}

it('keeps the same tool callable after an out-of-scope query is rejected', async () => {
  const ctx = new Context()
  const registered: RegisteredTool[] = []
  const removed = vi.fn()
  const { request } = withCatalogWatch(async (path, init) => {
    if (path === 'employee/me')
      return Response.json({
        connectors: [
          {
            id: 'mall',
            name: '商场',
            type: 'mcp',
            dataPermissions: ['operation.floor.1'],
            tools: [{ id: 'floor', name: 'getFloorDimensionData' }],
          },
        ],
      })
    if (path.endsWith('/call')) {
      const body = JSON.parse(String(init?.body)) as { arguments: { floorIds: string } }
      return body.arguments.floorIds === '1'
        ? Response.json({ content: [{ type: 'text', text: '一层销售' }] })
        : Response.json({ code: 'MCP_DATA_FORBIDDEN' }, { status: 403 })
    }
    return Response.json({ tools: [{ name: 'getFloorDimensionData', inputSchema: { type: 'object', properties: {} } }] })
  })
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: {
      value: {
        register: (tool: RegisteredTool) => {
          registered.push(tool)
          return removed
        },
      },
    },
  })
  const dispose = mountEnterpriseTools(ctx, 30000)
  try {
    await vi.waitFor(() => {
      expect(registered).toHaveLength(1)
    })
    const exec = { signal: AbortSignal.timeout(2000) }
    await expect(registered[0]!.execute({ floorIds: '2' }, exec)).rejects.toThrow('没有权限')
    expect(removed).not.toHaveBeenCalled()
    await expect(registered[0]!.execute({ floorIds: '1' }, exec)).resolves.toBeDefined()
    expect(registered).toHaveLength(1)
  } finally {
    await dispose()
  }
})

it('clears retained runtime authorization when the catalog watch fails', async () => {
  const ctx = new Context()
  let available = true
  const removed = vi.fn()
  const registered: RegisteredTool[] = []
  const { request, notify } = withCatalogWatch(async (path) => {
    if (!available) return Response.json({ code: 'CATALOG_UNAVAILABLE' }, { status: 503 })
    return path === 'employee/me'
      ? Response.json({ connectors: [{ id: 'mall', name: '商场', type: 'mcp', tools: [{ id: 'query', name: 'query' }] }] })
      : Response.json({ tools: [{ name: 'query', inputSchema: { type: 'object', properties: {} } }] })
  })
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: {
      value: {
        register: (tool: RegisteredTool) => {
          registered.push(tool)
          return removed
        },
      },
    },
  })
  const dispose = mountEnterpriseTools(ctx, 30000)
  try {
    await vi.waitFor(() => {
      expect(registered).toHaveLength(1)
    })
    available = false
    notify()
    await vi.waitFor(() => {
      expect(removed).toHaveBeenCalledOnce()
    })
    await expect(registered[0]!.execute({}, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
    expect(request.mock.calls.some(([path]) => path.endsWith('/call'))).toBe(false)
  } finally {
    await dispose()
  }
})

it('uses Host employee credentials, rejects other connector IDs, and filters live tools', async () => {
  const ctx = new Context()
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  const registered: RegisteredTool[] = []
  const { request } = withCatalogWatch(async (path: string) =>
    path === 'employee/me'
      ? Response.json({
        connectors: [
          {
            id: 'c1',
            name: '企业数据',
            type: 'mcp',
            icon: 'data:image/png;base64,iVBORw0KGgo=',
            endpoint: 'secret',
            tools: [{ id: 't1', name: 'search', description: '查询', allowed: true }],
          }
        ],
      })
      : path.endsWith('/call')
        ? Response.json({ content: [{ type: 'text', text: '查询完成' }] })
        : Response.json({ tools: [{ name: 'search', inputSchema: { type: 'object', properties: {} } }, { name: 'hidden' }] }),
  )
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: {
      value: {
        register: (definition: (typeof registered)[number]) => {
          registered.push(definition)
          return () => {}
        },
      },
    },
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route)
            return () => {}
          },
        },
      },
    },
  })
  apply(ctx, { refreshIntervalMs: 30000, ...personalConfig() })
  const route = routes.get('/api/lfclaw/connector-center')!
  const catalog = await route.fetch(new Request('http://localhost/api/lfclaw/connector-center'))
  expect(await catalog.json()).toMatchObject({
    connectors: [
      {
        id: 'c1',
        name: '企业数据',
        type: 'mcp',
        icon: 'data:image/png;base64,iVBORw0KGgo=',
        showToolsInClient: true,
        tools: [{ id: 't1', name: 'search', description: '查询' }],
      },
    ],
    refreshIntervalMs: 30000,
  })
  const forbidden = await route.fetch(new Request('http://localhost/api/lfclaw/connector-center?id=other'))
  expect(forbidden.status).toBe(403)
  expect(request.mock.calls.some(([path]) => path.includes('/other/'))).toBe(false)
  const discovery = await route.fetch(new Request('http://localhost/api/lfclaw/connector-center?id=c1'))
  expect(await discovery.json()).toMatchObject({ tools: [{ name: 'search' }] })
  expect(request).toHaveBeenCalledWith('employee/connectors/c1/tools', expect.anything())
  await vi.waitFor(() => {
    expect(registered).toHaveLength(1)
  })
  expect(registered[0]!.name).toMatch(/^lfclaw_search_[a-f0-9]{10}$/u)
  await registered[0]!.execute({}, { signal: AbortSignal.timeout(1000) })
  expect(request).toHaveBeenCalledWith('employee/connectors/c1/call', expect.objectContaining({ method: 'POST' }))
  await ctx.fiber.dispose()
})

it('keeps the connector card but hides its tool names while retaining its authorized runtime tool', async () => {
  const ctx = new Context()
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  const registered: RegisteredTool[] = []
  const { request } = withCatalogWatch(async (path: string) =>
    path === 'employee/me'
      ? Response.json({
        connectors: [
          {
            id: 'private',
            name: '后台连接器',
            type: 'mcp',
            showToolsInClient: false,
            tools: [{ id: 't1', name: 'lookup', description: '查询' }],
          }
        ],
      })
      : Response.json({ tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }] }),
  )
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: {
      value: {
        register: (definition: RegisteredTool) => {
          registered.push(definition)
          return () => {}
        },
      },
    },
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route)
            return () => {}
          },
        },
      },
    },
  })
  apply(ctx, { refreshIntervalMs: 30000, ...personalConfig() })
  const route = routes.get('/api/lfclaw/connector-center')!
  expect(await (await route.fetch(new Request('http://localhost/api/lfclaw/connector-center'))).json()).toMatchObject({
    connectors: [
      { id: 'private', name: '后台连接器', type: 'mcp', icon: '', showToolsInClient: false, hasAvailableTools: true, tools: [] },
    ],
    refreshIntervalMs: 30000,
  })
  const details = await route.fetch(new Request('http://localhost/api/lfclaw/connector-center?id=private'))
  expect(details.status).toBe(200)
  expect(await details.json()).toEqual({
    connector: { id: 'private', name: '后台连接器', type: 'mcp', icon: '', showToolsInClient: false, tools: [] },
    tools: [],
  })
  expect(request.mock.calls.filter(([path]) => path.includes('/private/tools'))).toHaveLength(2)
  await vi.waitFor(() => {
    expect(registered).toHaveLength(1)
  })
  await ctx.fiber.dispose()
})

it('unregisters a live tool immediately when the server reports revoked authorization', async () => {
  const ctx = new Context()
  let allowed = true
  const dispose = vi.fn()
  const register = vi.fn(() => dispose)
  const { request, notify } = withCatalogWatch(async (path: string) =>
    path === 'employee/me'
      ? Response.json({
        connectors: allowed
          ? [{ id: 'c1', name: '企业数据', type: 'mcp', tools: [{ id: 't1', name: 'search', description: '查询' }] }]
          : [],
      })
      : Response.json({ tools: [{ name: 'search', inputSchema: { type: 'object', properties: {} } }] }),
  )
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: { value: { register } },
    connection: { value: { fetch: { register: () => () => {} } } },
  })
  apply(ctx, { refreshIntervalMs: 30000, ...personalConfig() })
  try {
    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledOnce()
    })
    allowed = false
    notify()
    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalledOnce()
    })
  } finally {
    await ctx.fiber.dispose()
  }
})

it('does not register an old discovery result after a newer authorization revision', async () => {
  const ctx = new Context()
  const register = vi.fn(() => () => {})
  let allowed = true
  const discovery = Promise.withResolvers<Response>()
  const { request, notify } = withCatalogWatch(async path =>
    path === 'employee/me'
      ? Response.json({
        connectors: allowed
          ? [
            {
              id: 'mall',
              name: '商场',
              type: 'mcp',
              dataPermissions: ['operation.floor.1'],
              tools: [{ id: 'query', name: 'query' }],
            }
          ]
          : [],
      })
      : discovery.promise,
  )
  Object.defineProperties(ctx, { enterpriseConnection: { value: { request } }, tools: { value: { register } } })
  const dispose = mountEnterpriseTools(ctx, 30000)
  try {
    await vi.waitFor(() => {
      expect(request.mock.calls.some(([path]) => path.endsWith('/tools'))).toBe(true)
    })
    allowed = false
    notify()
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([path]) => path.includes('?revision=')).length).toBe(2)
    })
    discovery.resolve(Response.json({ tools: [{ name: 'query', inputSchema: { type: 'object', properties: {} } }] }))
    await dispose()
    expect(register).not.toHaveBeenCalled()
  } finally {
    discovery.resolve(Response.json({ tools: [] }))
    await dispose()
  }
})

it('invalidates retained tool handles and in-flight responses when floor permissions change', async () => {
  const ctx = new Context()
  const registered: RegisteredTool[] = []
  const removed = vi.fn()
  let permissions = ['operation.floor.1']
  const result = Promise.withResolvers<Response>()
  const { request, notify } = withCatalogWatch(async path =>
    path === 'employee/me'
      ? Response.json({
        connectors: [
          { id: 'mall', name: '商场', type: 'mcp', dataPermissions: permissions, tools: [{ id: 'query', name: 'query' }] },
        ]
      })
      : path.endsWith('/call')
        ? result.promise
        : Response.json({
          tools: [{ name: 'query', description: permissions.join(','), inputSchema: { type: 'object', properties: {} } }],
        }),
  )
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: {
      value: {
        register: (tool: RegisteredTool) => {
          registered.push(tool)
          return removed
        },
      },
    },
  })
  const dispose = mountEnterpriseTools(ctx, 30000)
  try {
    await vi.waitFor(() => {
      expect(registered).toHaveLength(1)
    })
    const original = registered[0]!
    const pending = original.execute({}, { signal: new AbortController().signal })
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => {
      expect(request.mock.calls.some(([path]) => path.endsWith('/call'))).toBe(true)
    })
    permissions = ['operation.floor.2']
    notify()
    await vi.waitFor(() => {
      expect(registered).toHaveLength(2)
    })
    expect(removed).toHaveBeenCalledOnce()
    result.resolve(Response.json({ content: [{ type: 'text', text: '旧一层数据' }] }))
    await rejected
    const before = request.mock.calls.length
    await expect(original.execute({}, { signal: new AbortController().signal })).rejects.toThrow()
    expect(request.mock.calls.length).toBe(before)
  } finally {
    result.resolve(Response.json({ content: [] }))
    await dispose()
  }
})
