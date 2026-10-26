import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { mountPersonalConnectors } from '../src/personal.ts'
import { parsePersonalConnector, PersonalConnectorStore, publicPersonalConnector } from '../src/personal-store.ts'

it('partitions local configurations by employee and preserves masked secrets only for the unchanged service', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-connectors-'))
  try {
    const store = new PersonalConnectorStore(directory)
    const item = parsePersonalConnector({
      name: 'My MCP',
      url: 'https://example.com/sse',
      headers: { Authorization: 'Bearer fixture' },
    })
    await store.update('employee-a', () => [item])
    expect(await store.list('employee-b')).toEqual([])
    const masked = publicPersonalConnector((await store.list('employee-a'))[0]!)
    expect(masked.headers).toEqual({ Authorization: '' })
    expect(parsePersonalConnector(masked, item).headers.Authorization).toBe('Bearer fixture')
    expect(() => parsePersonalConnector({ ...masked, url: 'https://other.example.com/sse' }, item)).toThrow('invalid')
    expect(() => parsePersonalConnector({ ...masked, revision: 'old' }, item)).toThrow('conflict')
    expect(() => parsePersonalConnector({ name: 'Bad', url: 'file:///data' })).toThrow('invalid')
    const path = join(directory, (await readdir(directory))[0]!)
    const invalid = JSON.stringify([{ ...item, enabled: undefined }])
    await writeFile(path, invalid)
    await expect(store.list('employee-a')).rejects.toMatchObject({ code: 'storage' })
    expect(await readFile(path, 'utf8')).toBe(invalid)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('saves personal MCPs, masks credentials, registers callable tools, and rejects stale or other-account executions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'personal-mcp-host-'))
  let calls = 0
  const upstream = createServer(async (request, response) => {
    if (request.url === '/reject') {
      response.writeHead(405).end()
      return
    }
    expect(request.headers['x-api-key']).toBe('fixture-key')
    expect(request.headers.authorization).toBeUndefined()
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (!chunks.length) {
      response.writeHead(405).end()
      return
    }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: number; method: string }
    if (message.id === undefined) {
      response.writeHead(202).end()
      return
    }
    if (message.method === 'tools/call') calls += 1
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'lookup', description: 'Look up fixture data', inputSchema: { type: 'object', properties: {} } }] }
          : { content: [{ type: 'text', text: 'fixture result' }] }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address()
  expect(address).not.toBeNull()
  if (!address || typeof address === 'string') throw new Error('missing address')
  const ctx = new Context()
  let employee = 'e1'
  let protectedService = false
  let route: { fetch: (request: Request) => Promise<Response> } | undefined
  const tools = new Map<
    string,
    {
      name: string
      description: string
      execute: (args: Record<string, unknown>, execution: { signal: AbortSignal }) => Promise<unknown>
    }
  >()
  Object.defineProperties(ctx, {
    enterpriseConnection: {
      value: {
        request: async (path: string) =>
          path === 'employee/identity'
            ? Response.json({ employee: { id: employee } })
            : Response.json({}, { status: protectedService ? 403 : 200 }),
      },
    },
    tools: {
      value: {
        register: (tool: typeof tools extends Map<string, infer T> ? T : never) => {
          tools.set(tool.name, tool)
          return () => {
            tools.delete(tool.name)
          }
        },
      },
    },
    connection: {
      value: {
        fetch: {
          register: (value: NonNullable<typeof route>) => {
            route = value
            return () => {}
          },
        },
      },
    },
  })
  const dispose = mountPersonalConnectors(ctx, {
    dataDirectory: directory,
    refreshIntervalMs: 30000,
    requestTimeoutMs: 2000,
    maxConfigBytes: 65536,
  })
  const send = (body?: object) =>
    route!.fetch(
      new Request('http://localhost/api/lfclaw/personal-connectors', body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    )
  try {
    const item = {
      name: 'My service',
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { 'X-API-Key': 'fixture-key' },
      transport: 'streamable-http',
    }
    const removedImport = await send({
      operation: 'import',
      config: {
        mcpServers: {
          offline: { url: 'https://example.com/mcp', disabled: true },
        },
      },
    })
    expect(removedImport.status).toBe(400)
    expect(await removedImport.json()).toEqual({ code: 'invalid' })
    const rejected = await send({
      operation: 'test',
      item: { name: 'Wrong transport', url: `http://127.0.0.1:${address.port}/reject`, transport: 'sse' },
    })
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toEqual({ code: 'transportRejected', connectorName: 'Wrong transport' })
    expect(((await (await send()).json()) as { connectors: unknown[] }).connectors).toEqual([])
    protectedService = true
    expect((await send({ operation: 'save', item })).status).toBe(403)
    protectedService = false
    expect((await send({ operation: 'save', item })).status).toBe(200)
    const catalog = (await (await send()).json()) as {
      connectors: Array<{ id: string; revision: string; enabled: boolean; headers: Record<string, string> }>
    }
    const saved = catalog.connectors[0]!
    expect(saved.headers).toEqual({ 'X-API-Key': '' })
    const picker = await route!.fetch(new Request('http://localhost/api/lfclaw/personal-connectors?view=picker'))
    expect(await picker.json()).toEqual({ connectors: [{ id: saved.id, name: 'My service', enabled: true, connected: true }] })
    expect(tools.size).toBe(1)
    const tool = [...tools.values()][0]!
    expect(tool.description).toBe('My service：Look up fixture data')
    const result = await tool.execute({}, { signal: AbortSignal.timeout(2000) })
    expect(JSON.stringify(result)).toContain('fixture result')
    expect({ description: tool.description, result }).toMatchSnapshot()
    employee = 'e2'
    await expect(tool.execute({}, { signal: AbortSignal.timeout(2000) })).rejects.toThrow('conflict')
    expect(((await (await send()).json()) as { connectors: unknown[] }).connectors).toEqual([])
    employee = 'e1'
    expect((await send({ operation: 'remove', id: saved.id, revision: 'old' })).status).toBe(409)
    expect((await send({ operation: 'remove', id: saved.id, revision: saved.revision })).status).toBe(200)
    expect(tools.size).toBe(0)
    await expect(tool.execute({}, { signal: AbortSignal.timeout(2000) })).rejects.toThrow('conflict')
    expect(calls).toBe(1)
    expect(
      (
        await send({
          operation: 'save',
          item: {
            name: 'offline',
            url: 'https://example.com/sse2',
            enabled: false,
          },
        })
      ).status,
    ).toBe(200)
    const files = await import('node:fs/promises').then(fs => fs.readdir(directory))
    expect(await readFile(join(directory, files[0]!), 'utf8')).not.toContain('fixture-key')
    expect(
      (
        await send({
          operation: 'save',
          item: {
            name: 'Local fixture',
            transport: 'stdio',
            command: process.execPath,
            args: [fileURLToPath(new URL('./fixtures/personal-stdio.mjs', import.meta.url))],
            env: { PERSONAL_FIXTURE_VALUE: 'explicit environment' },
          },
        })
      ).status,
    ).toBe(200)
    expect(tools.size).toBe(1)
    const local = [...tools.values()][0]!
    expect(JSON.stringify(await local.execute({}, { signal: AbortSignal.timeout(2000) }))).toContain('explicit environment')
  } finally {
    await dispose()
    expect(tools.size).toBe(0)
    upstream.closeAllConnections()
    upstream.close()
    await once(upstream, 'close')
    await rm(directory, { recursive: true, force: true })
  }
})
