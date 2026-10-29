import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { withCatalogWatch } from './watch-fixture.ts'

it('serves enterprise and personal picker options without waiting for full catalog synchronization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lfclaw-connector-picker-'))
  const ctx = new Context()
  const fullCatalog = Promise.withResolvers<undefined>()
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  let authorized = true
  const { request } = withCatalogWatch(async (path) => {
    if (path === 'employee/me') {
      await fullCatalog.promise
      return Response.json({ connectors: [] })
    }
    if (!authorized) return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 })
    if (path === 'employee/identity') return Response.json({ employee: { id: 'employee' } })
    if (path === 'employee/connector-picker')
      return Response.json({ connectors: [{ id: 'c1', name: '企业数据', hasAvailableTools: true }] })
    throw new Error('Unexpected request: ' + path)
  })
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    tools: { value: { register: () => () => {} } },
    connection: { value: { fetch: { register(route: { path: string; fetch: (request: Request) => Promise<Response> }) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    } } } },
  })
  apply(ctx, { refreshIntervalMs: 30000, dataDirectory: directory, requestTimeoutMs: 2000, maxConfigBytes: 65536 })
  const read = (path: string) => {
    const route = routes.get('/api/lfclaw/' + path)
    if (!route) throw new Error('Missing picker route')
    return route.fetch(new Request('http://localhost/api/lfclaw/' + path + '?view=picker'))
  }
  let completed: unknown
  const pending = Promise.all([read('connector-center'), read('personal-connectors')])
    .then(async (responses) => { completed = await Promise.all(responses.map(response => response.json())) })
  try {
    await vi.waitFor(() => { expect(completed).toEqual([
      { connectors: [{ id: 'c1', name: '企业数据', hasAvailableTools: true }] },
      { connectors: [] },
    ]) })
    expect(request.mock.calls.some(([path]) => path === 'employee/identity')).toBe(true)
    expect(request.mock.calls.some(([path]) => path === 'employee/connector-picker')).toBe(true)
    authorized = false
    expect((await read('connector-center')).status).toBe(401)
    expect((await read('personal-connectors')).status).toBe(401)
  } finally {
    fullCatalog.resolve(undefined)
    await pending
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
