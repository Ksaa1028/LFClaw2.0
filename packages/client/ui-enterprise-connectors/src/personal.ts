/** Personal MCP management and automatic tool registration for the current employee. */
import { createHash, randomUUID } from 'node:crypto'
import { PersonalOAuth } from './personal-oauth.ts'
import type { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { McpToolDefinitionOptions } from '@deepseek-ai/dsh-mcp-client'
import { connectorToolDefinitions, resolveToolCatalogConfig } from './tool-catalog.ts'
import {
  PersonalConnectorError,
  PersonalConnectorStore,
  parsePersonalConnector,
  publicPersonalConnector,
  type PersonalConnector,
} from './personal-store.ts'
import type { Config } from './index.ts'

type DiscoveredTool = Awaited<ReturnType<Client['listTools']>>['tools'][number]
interface Status {
  connected: boolean
  authorizationRequired?: boolean
  tools: { id: string; name: string; description: string }[]
}

/** Mount local CRUD, live discovery, and employee-scoped model tools.
 * @param ctx - Host services; enterprise credentials stay in enterpriseConnection.
 * @param config - local storage and request budgets.
 * @returns async teardown that aborts requests and drains all work before unregistering tools.
 */
export function mountPersonalConnectors(ctx: Context, config: Config): () => Promise<void> {
  const catalogLimits = resolveToolCatalogConfig(config)
  const store = new PersonalConnectorStore(config.dataDirectory)
  const lifetime = new AbortController()
  const work = new Set<Promise<unknown>>()
  let employee = ''
  let disposers: (() => void)[] = []
  let status = new Map<string, Status>()
  const discovered = new Map<string, { connected: boolean; tools: DiscoveredTool[] }>()
  const discoveryKey = (owner: string, item: PersonalConnector) => `${owner}:${item.id}:${item.revision}`
  let synchronization: Promise<void> = Promise.resolve()
  const clear = () => {
    for (const dispose of disposers) dispose()
    disposers = []
    status = new Map()
  }
  const oauth = new PersonalOAuth(
    config.dataDirectory,
    config.requestTimeoutMs,
    config.oauthFlowTtlMs ?? config.requestTimeoutMs,
    lifetime.signal,
    async (owner, item) =>
      (await current(lifetime.signal)) === owner &&
      (await store.list(owner)).some(saved => saved.id === item.id && saved.revision === item.revision && saved.enabled),
  )
  async function current(signal: AbortSignal, catalogMaxAgeMs = 0): Promise<string> {
    const response = await ctx.enterpriseConnection.request('employee/identity', {
      signal: AbortSignal.any([signal, lifetime.signal]),
      catalogMaxAgeMs,
    })
    if (!response.ok)
      throw new PersonalConnectorError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'unavailable')
    const data: unknown = await response.json()
    if (
      !data ||
      typeof data !== 'object' ||
      !('employee' in data) ||
      !data.employee ||
      typeof data.employee !== 'object' ||
      !('id' in data.employee) ||
      typeof data.employee.id !== 'string'
    )
      throw new PersonalConnectorError('unavailable')
    return data.employee.id
  }
  async function policy(item: PersonalConnector, signal: AbortSignal): Promise<void> {
    if (item.transport === 'stdio') return
    const response = await ctx.enterpriseConnection.request('employee/personal-connectors/check', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: item.url }),
    })
    if (!response.ok) throw new PersonalConnectorError(response.status === 403 ? 'protected' : 'unavailable')
  }
  async function connect<T>(
    item: PersonalConnector,
    parent: AbortSignal,
    use: (client: Client, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(config.requestTimeoutMs)])
    signal.throwIfAborted()
    await policy(item, signal)
    const authorization = item.auth === 'oauth' ? await oauth.provider(await current(signal), item) : undefined
    const oauthOptions = authorization ? { authProvider: authorization.provider, fetch: oauth.fetch } : {}
    const client = new Client({ name: 'lfclaw-personal', version: '0.1.0' })
    const transport =
      item.transport === 'stdio'
        ? new StdioClientTransport({
          command: item.command,
          args: item.args,
          env: { ...scrubbedParentEnv(), ...item.env },
          stderr: 'ignore',
        })
        : item.transport === 'sse'
          ? new SSEClientTransport(new URL(item.url), { ...oauthOptions, requestInit: { headers: item.headers, signal } })
          : new StreamableHTTPClientTransport(new URL(item.url), {
            ...oauthOptions,
            requestInit: { headers: item.headers, signal },
          })
    const abort = () => {
      void client.close().catch((_error: unknown) => {
        /* The owner awaits and reports close in finally. */
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      // SDK 1.x declares Streamable HTTP sessionId as explicit undefined while Transport makes it optional.
      await client.connect(transport as Parameters<Client['connect']>[0])
      signal.throwIfAborted()
      const result = await use(client, signal)
      await authorization?.assertCurrent()
      return result
    } finally {
      signal.removeEventListener('abort', abort)
      await client.close()
    }
  }
  async function discover(item: PersonalConnector, signal: AbortSignal): Promise<DiscoveredTool[]> {
    try {
      return await connect(item, signal, async (client, requestSignal) => {
        const tools: DiscoveredTool[] = []
        let cursor: string | undefined
        const cursors = new Set<string>()
        do {
          const result = await client.listTools(cursor ? { cursor } : undefined, {
            timeout: config.requestTimeoutMs,
            signal: requestSignal,
          })
          tools.push(...result.tools)
          cursor = result.nextCursor
          if (cursor && cursors.has(cursor)) throw new PersonalConnectorError('unavailable')
          if (cursor) cursors.add(cursor)
        } while (cursor)
        return tools
      })
    } catch (error) {
      const code =
        error instanceof PersonalConnectorError
          ? error.code
          : (error instanceof SseError || error instanceof StreamableHTTPError) && error.code === 405
            ? 'transportRejected'
            : 'unavailable'
      throw new PersonalConnectorError(code, item.name)
    }
  }
  function track<T>(promise: Promise<T>): Promise<T> {
    work.add(promise)
    void promise.then(
      () => work.delete(promise),
      () => work.delete(promise),
    )
    return promise
  }
  const sync = (refreshExisting = true): Promise<void> => {
    synchronization = synchronization
      .then(async () => {
        if (lifetime.signal.aborted) return
        const owner = await current(lifetime.signal)
        const items = await store.list(owner)
        clear()
        employee = owner
        for (const item of items) {
          if (lifetime.signal.aborted) return
          if (!item.enabled) {
            status.set(item.id, { connected: false, tools: [] })
            continue
          }
          try {
            const key = discoveryKey(owner, item)
            const cached = refreshExisting ? undefined : discovered.get(key)
            if (cached && !cached.connected) {
              status.set(item.id, { connected: false, tools: [] })
              continue
            }
            const tools = cached?.tools ?? (await discover(item, lifetime.signal))
            discovered.set(key, { connected: true, tools })
            if (lifetime.signal.aborted) return
            const registered: (() => void)[] = []
            try {
              const options: McpToolDefinitionOptions[] = tools.map((tool) => {
                const digest = createHash('sha256').update(`${owner}\0${item.id}\0${tool.name}`).digest('hex').slice(0, 16)
                return {
                  name: `lfclaw_personal_${digest}`,
                  rawName: tool.name,
                  description: `${item.name}：${tool.description ?? tool.name}`,
                  inputSchema: tool.inputSchema,
                  call: (args, execution) =>
                    track(
                      (async () => {
                        const activeOwner = await current(execution.signal)
                        const active = (await store.list(activeOwner)).find(saved => saved.id === item.id)
                        if (activeOwner !== owner || !active?.enabled || active.revision !== item.revision)
                          throw new PersonalConnectorError('conflict')
                        const result = await connect(active, execution.signal, (client, signal) =>
                          client.callTool({ name: tool.name, arguments: args }, undefined, {
                            signal,
                            timeout: config.requestTimeoutMs,
                          }),
                        )
                        if (
                          (await current(execution.signal)) !== owner ||
                          !(await store.list(owner)).some(
                            saved => saved.id === active.id && saved.revision === active.revision && saved.enabled,
                          )
                        )
                          throw new PersonalConnectorError('conflict')
                        return result
                      })(),
                    ),
                }
              })
              const catalogName = `lfclaw_personal_${createHash('sha256').update(`${owner}\0${item.id}\0catalog`).digest('hex').slice(0, 16)}`
              for (const definition of connectorToolDefinitions(ctx, catalogName, item.name, options, catalogLimits, async () => {
                if (
                  lifetime.signal.aborted ||
                  (await current(lifetime.signal)) !== owner ||
                  !(await store.list(owner)).some(
                    saved => saved.id === item.id && saved.revision === item.revision && saved.enabled,
                  )
                ) {
                  throw new PersonalConnectorError('conflict')
                }
              })) {
                registered.push(ctx.tools.register(definition))
              }
              disposers.push(...registered)
            } catch (error) {
              for (const dispose of registered) dispose()
              throw error
            }
            status.set(item.id, {
              connected: true,
              tools: tools.map(tool => ({ id: tool.name, name: tool.name, description: tool.description ?? '' })),
            })
          } catch (error) {
            discovered.set(discoveryKey(owner, item), { connected: false, tools: [] })
            const authorizationRequired = error instanceof PersonalConnectorError && error.code === 'authorizationRequired'
            status.set(item.id, { connected: false, authorizationRequired, tools: [] })
            if (!lifetime.signal.aborted && !authorizationRequired)
              ctx.logger.warn('个人连接器连接失败：%s', error instanceof PersonalConnectorError ? error.code : 'unavailable')
          }
        }
        const retained = new Set(items.map(item => discoveryKey(owner, item)))
        for (const key of discovered.keys()) if (!retained.has(key)) discovered.delete(key)
      })
      .catch((error: unknown) => {
        clear()
        employee = ''
        if (!lifetime.signal.aborted)
          ctx.logger.warn('个人连接器目录不可用：%s', error instanceof PersonalConnectorError ? error.code : 'unavailable')
      })
    return synchronization
  }
  const routeDispose = ctx.connection.fetch.register({
    path: '/api/lfclaw/personal-connectors',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: request =>
      track(
        (async () => {
          try {
            const signal = AbortSignal.any([request.signal, lifetime.signal])
            const owner = await current(signal, request.method === 'GET' ? config.refreshIntervalMs : 0)
            if (request.method === 'GET') {
              if (employee !== owner) await sync()
              if (new URL(request.url).searchParams.get('view') === 'picker') {
                return Response.json({
                  connectors: (await store.list(owner)).map(item => ({
                    id: item.id, name: item.name, enabled: item.enabled,
                    connected: status.get(item.id)?.connected ?? false,
                  })),
                })
              }
              return Response.json({
                connectors: (await store.list(owner)).map(item => ({
                  ...publicPersonalConnector(item),
                  connected: status.get(item.id)?.connected ?? false,
                  authorizationRequired: status.get(item.id)?.authorizationRequired === true,
                  tools: status.get(item.id)?.tools ?? [],
                })),
              })
            }
            const bytes = await request.arrayBuffer()
            if (bytes.byteLength > config.maxConfigBytes) return Response.json({ code: 'invalid' }, { status: 413 })
            const input: unknown = JSON.parse(new TextDecoder().decode(bytes))
            if (!input || typeof input !== 'object' || !('operation' in input)) throw new PersonalConnectorError('invalid')
            const operation = input.operation
            if (operation === 'refresh') {
              await sync()
              return Response.json({ ok: true })
            }
            const items = await store.list(owner)
            if ((operation === 'oauth' || operation === 'disconnect') && 'id' in input && 'revision' in input) {
              const item = items.find(item => item.id === input.id && item.revision === input.revision)
              if (!item || item.auth !== 'oauth' || !item.enabled) throw new PersonalConnectorError('conflict')
              await policy(item, signal)
              if (operation === 'oauth') {
                const result = await oauth.provider(owner, item, async () => {
                  discovered.delete(discoveryKey(owner, item))
                  await sync()
                })
                return Response.json({ authorizationUrl: result.authorizationUrl }, { headers: { 'Cache-Control': 'no-store' } })
              }
              await store.update(owner, saved =>
                saved.map((candidate) => {
                  if (candidate.id !== item.id) return candidate
                  if (candidate.revision !== item.revision) throw new PersonalConnectorError('conflict')
                  return { ...candidate, revision: randomUUID() }
                }),
              )
              await oauth.remove(owner, item)
              discovered.delete(discoveryKey(owner, item))
              clear()
              await sync()
              return Response.json({ ok: true })
            }
            if (operation === 'remove' && 'id' in input && 'revision' in input) {
              const removed = items.find(item => item.id === input.id)
              await store.update(owner, (saved) => {
                const prior = saved.find(item => item.id === input.id)
                if (!prior || prior.revision !== input.revision) throw new PersonalConnectorError('conflict')
                return saved.filter(item => item.id !== prior.id)
              })
              if (removed?.auth === 'oauth') await oauth.remove(owner, removed)
            } else if ((operation === 'save' || operation === 'test') && 'item' in input) {
              const raw = input.item
              const prior = raw && typeof raw === 'object' && 'id' in raw ? items.find(item => item.id === raw.id) : undefined
              if (raw && typeof raw === 'object' && 'id' in raw && !prior) throw new PersonalConnectorError('conflict')
              const candidate = parsePersonalConnector(raw, prior)
              if (operation === 'test') return Response.json({ tools: await discover(candidate, signal) })
              const tools = candidate.enabled && candidate.auth !== 'oauth' ? await discover(candidate, signal) : []
              await store.update(owner, (saved) => {
                if (prior && saved.find(item => item.id === prior.id)?.revision !== prior.revision)
                  throw new PersonalConnectorError('conflict')
                if (saved.some(item => item.id !== candidate.id && item.name === candidate.name))
                  throw new PersonalConnectorError('conflict')
                return [...saved.filter(item => item.id !== candidate.id), candidate]
              })
              if (prior?.auth === 'oauth') await oauth.remove(owner, prior)
              discovered.set(discoveryKey(owner, candidate), {
                connected: candidate.enabled && candidate.auth !== 'oauth',
                tools,
              })
            } else throw new PersonalConnectorError('invalid')
            clear()
            await sync(false)
            return Response.json({ ok: true })
          } catch (error) {
            const code =
              error instanceof PersonalConnectorError ? error.code : error instanceof SyntaxError ? 'invalid' : 'unavailable'
            if (code === 'unauthorized') {
              clear()
              employee = ''
            }
            return Response.json(
              {
                code,
                ...(error instanceof PersonalConnectorError && error.connectorName ? { connectorName: error.connectorName } : {}),
              },
              {
                status:
                  code === 'unauthorized'
                    ? 401
                    : code === 'conflict'
                      ? 409
                      : code === 'protected'
                        ? 403
                        : code === 'invalid'
                          ? 400
                          : 503,
              },
            )
          }
        })(),
      ),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const poll = () => {
    void sync().finally(() => {
      if (!lifetime.signal.aborted) timer = setTimeout(poll, config.refreshIntervalMs)
    })
  }
  poll()
  return async () => {
    routeDispose()
    clearTimeout(timer)
    lifetime.abort()
    clear()
    await oauth.dispose()
    await synchronization
    await Promise.allSettled([...work])
    clear()
    discovered.clear()
  }
}
