/** LFClaw connector catalog proxy: the desktop Host keeps the employee token private. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-ui-activation'
import z from '@deepseek-ai/schemastery'
import { catalogRevision, parseConnectors } from './catalog.ts'
import { mountEnterpriseTools } from './tools.ts'
import { mountPersonalConnectors } from './personal.ts'
import type { ToolCatalogConfig } from './tool-catalog.ts'
import { EnterpriseOAuthRelay } from './enterprise-oauth.ts'

/** Plugin identifier. */
export const name = 'lfclaw-connector-center'
/** Required Host services. */
export const inject = ['connection', 'enterpriseConnection', 'tools']
/** Enterprise synchronization and personal connector configuration. */
export interface Config extends Partial<ToolCatalogConfig> {
  /** Maximum browser authorization duration; older direct callers use requestTimeoutMs. */
  oauthFlowTtlMs?: number
  /** Retry delay after authorization synchronization fails, in milliseconds. */
  refreshIntervalMs: number
  /** Private directory containing employee-specific personal connector settings. */
  dataDirectory: string
  /** Personal MCP connection and operation timeout, in milliseconds. */
  requestTimeoutMs: number
  /** Maximum personal connector configuration request size, in bytes. */
  maxConfigBytes: number
}
/** Deployment configuration. */
export const Config: z<Config> = z.object({ refreshIntervalMs: z.number().min(1000).required(),
  inlineToolSchemaChars: z.number().step(1).min(1).default(16000),
  toolCatalogPageSize: z.number().step(1).min(1).default(10),
  toolDefinitionPageChars: z.number().step(1).min(1).default(12000),
  toolSummaryChars: z.number().step(1).min(1).default(320),
  oauthFlowTtlMs: z.number().min(60000).default(600000),
  dataDirectory: z.string().required(), requestTimeoutMs: z.number().min(1).required(), maxConfigBytes: z.number().min(1).required() })

/**
 * Register the employee-scoped catalog and live tool-list route.
 * @param ctx - desktop Host context.
 * @param config - deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  const oauth = new EnterpriseOAuthRelay((path, init) => ctx.enterpriseConnection.request(path, init),
    config.requestTimeoutMs, config.oauthFlowTtlMs ?? config.requestTimeoutMs)
  ctx.effect(() => () => oauth.dispose(), 'lfclaw: enterprise OAuth callbacks')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/lfclaw/connector-credentials', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const id = new URL(request.url).searchParams.get('id')
        const bytes = await request.arrayBuffer()
        if (!id || bytes.byteLength > config.maxConfigBytes) return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
        const input: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (!input || typeof input !== 'object' || Array.isArray(input) || !('operation' in input)
          || !['save', 'remove', 'oauth'].includes(String(input.operation))
          || Object.keys(input).some(key => !['operation', 'values', 'configuration'].includes(key))) return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
        if (input.operation === 'oauth') {
          if (!('configuration' in input) || typeof input.configuration !== 'string') return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
          return await oauth.start(id, input.configuration, request.signal)
        }
        if (input.operation === 'remove') oauth.cancel(id)
        const upstream = await ctx.enterpriseConnection.request(`employee/connectors/${encodeURIComponent(id)}/credentials`, {
          method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        })
        if (!upstream.ok) {
          const failure: unknown = await upstream.json()
          const callbackUnavailable = failure !== null && typeof failure === 'object' && 'code' in failure
            && failure.code === 'OAUTH_CALLBACK_UNAVAILABLE'
          return Response.json({ code: callbackUnavailable ? 'OAUTH_CALLBACK_UNAVAILABLE'
            : upstream.status === 400 ? 'ACCOUNT_INVALID'
              : upstream.status === 403 ? 'CONNECTOR_FORBIDDEN' : 'ACCOUNT_CONNECTION_FAILED' }, { status: upstream.status })
        }
        const result: unknown = await upstream.json()
        if (!result || typeof result !== 'object') throw new Error('invalid credential response')
        if (!('configured' in result) || typeof result.configured !== 'boolean') throw new Error('invalid account status')
        return Response.json({ configured: result.configured }, { headers: { 'Cache-Control': 'no-store' } })
      } catch { return Response.json({ code: 'ACCOUNT_CONNECTION_FAILED' }, { status: 503 }) }
    },
  }), 'lfclaw: generic connector credentials')
  ctx.effect(() => mountEnterpriseTools(ctx, config.refreshIntervalMs, config), 'lfclaw: authorized connector tools')
  ctx.effect(() => mountPersonalConnectors(ctx, config), 'lfclaw: personal connector tools')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/lfclaw/connector-account', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const id = new URL(request.url).searchParams.get('id')
        if (!id) return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
        let body: string | undefined
        const bytes = await request.arrayBuffer()
        if (bytes.byteLength > config.maxConfigBytes) return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 413 })
        const input: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (!input || typeof input !== 'object' || !('operation' in input)
          || input.operation !== 'save' && input.operation !== 'remove') return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
        if (input.operation === 'save') {
          if (!('appId' in input) || typeof input.appId !== 'string'
            || !('appSecret' in input) || typeof input.appSecret !== 'string' || Object.keys(input).length !== 3) {
            return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
          }
          body = JSON.stringify({ appId: input.appId, appSecret: input.appSecret })
        } else if (Object.keys(input).length !== 1) return Response.json({ code: 'ACCOUNT_INVALID' }, { status: 400 })
        const upstream = await ctx.enterpriseConnection.request(`employee/connectors/${encodeURIComponent(id)}/account`, {
          method: input.operation === 'save' ? 'PUT' : 'DELETE', signal: request.signal, headers: { 'Content-Type': 'application/json' }, ...(body ? { body } : {}),
        })
        if (!upstream.ok) {
          const code = upstream.status === 400 ? 'ACCOUNT_INVALID' : upstream.status === 409 ? 'CONNECTOR_ACCESS_CHANGED'
            : upstream.status === 401 || upstream.status === 403 ? 'CONNECTOR_FORBIDDEN' : 'ACCOUNT_CONNECTION_FAILED'
          return Response.json({ code }, { status: upstream.status })
        }
        const result: unknown = await upstream.json()
        if (!result || typeof result !== 'object' || !('configured' in result) || result.configured !== (input.operation === 'save')) {
          return Response.json({ code: 'ACCOUNT_CONNECTION_FAILED' }, { status: 503 })
        }
        return Response.json({ configured: result.configured }, { headers: { 'Cache-Control': 'no-store' } })
      } catch {
        return Response.json({ code: 'ACCOUNT_CONNECTION_FAILED' }, { status: 503 })
      }
    },
  }), 'lfclaw: employee connector account')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/lfclaw/connector-center', methods: ['GET'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const params = new URL(request.url).searchParams
        const id = params.get('id')
        if (!id && params.get('view') === 'picker') {
          const response = await ctx.enterpriseConnection.request('employee/connector-picker', { signal: request.signal })
          return new Response(response.body, {
            status: response.status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          })
        }
        const revision = id ? null : params.get('revision')
        const catalogResponse = await ctx.enterpriseConnection.request(`employee/connector-catalog${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`, {
          signal: request.signal, catalogMaxAgeMs: !id && !revision && params.get('refresh') !== '1' ? config.refreshIntervalMs : 0,
        })
        if (!catalogResponse.ok) return Response.json({ code: 'CATALOG_UNAVAILABLE' }, { status: catalogResponse.status === 401 ? 401 : 503 })
        const value: unknown = await catalogResponse.json()
        const currentRevision = catalogRevision(value)
        const connectors = parseConnectors(value)
        if (!id) return Response.json({
          connectors: connectors.map(connector => ({ ...connector, hasAvailableTools: connector.tools.length > 0,
            tools: connector.showToolsInClient ? connector.tools : [] })),
          revision: currentRevision, refreshIntervalMs: config.refreshIntervalMs,
        }, { headers: { 'Cache-Control': 'no-store' } })
        const selected = connectors.find(connector => connector.id === id)
        if (!selected) return Response.json({ code: 'CONNECTOR_FORBIDDEN' }, { status: 403 })
        const upstream = await ctx.enterpriseConnection.request(`employee/connectors/${encodeURIComponent(id)}/tools`, { signal: request.signal })
        if (!upstream.ok) return Response.json({ code: 'CONNECTOR_UNAVAILABLE' }, { status: upstream.status === 403 ? 403 : 503 })
        const discovered: unknown = await upstream.json()
        if (!discovered || typeof discovered !== 'object' || !('tools' in discovered) || !Array.isArray(discovered.tools)) throw new Error('invalid tools response')
        const latest = await ctx.enterpriseConnection.request('employee/connector-catalog', { signal: request.signal })
        if (!latest.ok || catalogRevision(await latest.json()) !== currentRevision) {
          return Response.json({ code: 'CONNECTOR_ACCESS_CHANGED' }, { status: 403 })
        }
        const tools = discovered.tools.flatMap((tool: unknown) => {
          if (!selected.showToolsInClient) return []
          if (tool === null || typeof tool !== 'object' || !('name' in tool) || typeof tool.name !== 'string'
            || !selected.tools.some(allowed => allowed.name === tool.name)) return []
          return [{ name: tool.name, description: 'description' in tool && typeof tool.description === 'string' ? tool.description : '' }]
        })
        return Response.json({ connector: selected.showToolsInClient ? selected : { ...selected, tools: [] }, tools }, { headers: { 'Cache-Control': 'no-store' } })
      } catch {
        return Response.json({ code: 'CONNECTOR_UNAVAILABLE' }, { status: 503 })
      }
    },
  }), 'lfclaw: connector catalog')
}
