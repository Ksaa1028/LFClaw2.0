/** Enterprise HTTP fixture for the shipped headless profile's permission snapshot. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { EnterpriseConnection } from '@deepseek-ai/dsh-client-ui-activation'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { mountEnterpriseTools } from '../src/tools.ts'
import { mallPublicResult, mallPublicSchema, restrictMallQuery } from '../../../../LFClaw/02-管理端/server/src/mcp-policy.ts'

/** Fixture plugin identifier. */
export const name = 'lfclaw-permission-session-fixture'
/** Required production registry. */
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

/** Scenario employee scope. */
export interface Config {
  /** Whether the fixture employee has every mall floor permission. */
  fullAccess: boolean
}
/** Optional complete-scope scenario; the default retains the single-floor recording. */
export const Config: z<Config> = z.object({ fullAccess: z.boolean().default(false) })

/**
 * Mount the production connection and tool runtime against an HTTP enterprise fixture.
 * @param ctx - Loader-owned context with the shipped tool registry.
 * @param config - fixture employee scope.
 * @returns completion after the local listener is ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const toolName = config.fullAccess ? 'getQiqiliyaTqbSaleData' : 'getFloorDimensionData'
  const description = config.fullAccess
    ? '淘气堡销售\n当前商场数据权限：一层、二层、三层、四层、自营。每次查询以当前授权为准。'
    : '楼层销售\n当前商场数据权限：一层。每次查询以当前授权为准。'
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer snapshot-employee') {
      res.writeHead(401).end()
      return
    }
    const url = new URL(req.url!, 'http://localhost')
    if (url.pathname === '/employee/connector-catalog' && url.searchParams.has('revision')) return
    const send = (body: object) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/employee/connector-catalog')
      send({
        revision: 'a'.repeat(64),
        connectors: [
          {
            id: 'mall',
            name: '商场数据',
            type: 'mcp',
            dataPermissions: config.fullAccess
              ? ['operation.floor.1', 'operation.floor.2', 'operation.floor.3', 'operation.floor.4', 'operation.self_operated']
              : ['operation.floor.1'],
            tools: [{ id: 'floor', name: toolName, description: '楼层销售' }],
          },
        ],
      })
    else if (url.pathname.endsWith('/tools'))
      send({
        tools: [
          mallPublicSchema(
            {
              name: toolName,
              description,
              inputSchema: config.fullAccess
                ? { type: 'object', properties: {} }
                : { type: 'object', properties: { floorIds: { type: 'string' } }, required: ['floorIds'] },
            },
            config.fullAccess
              ? ['operation.floor.1', 'operation.floor.2', 'operation.floor.3', 'operation.floor.4', 'operation.self_operated']
              : ['operation.floor.1'],
          ),
        ],
      })
    else if (url.pathname.endsWith('/call')) {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const request = JSON.parse(Buffer.concat(chunks).toString()) as { name: string; arguments: { floorIds: string } }
      const query = restrictMallQuery(toolName, request.arguments, ['operation.floor.1'])
      if (request.name !== toolName || (!config.fullAccess && query.arguments.floorIds !== '1')) {
        res.writeHead(403).end()
        return
      }
      send(
        config.fullAccess
          ? { content: [{ type: 'text', text: '淘气堡销售额：200 元（测试数据）' }] }
          : mallPublicResult(
            toolName,
            {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    info: '您拥有的权限有（一层、二层、三层、四层、自营）',
                    data: { 一层销售额: 100 },
                  }),
                },
                ...query.unavailableFloors.map(floor => ({ type: 'text' as const, text: `${floor}未授权，无法获取。` })),
              ]
            },
            ['operation.floor.1'],
          )
      )
    } else res.writeHead(404).end()
  })
  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing fixture port')
  const serverUrl = `http://127.0.0.1:${address.port}`
  new EnterpriseConnection(ctx, serverUrl, 30000, {
    read: async () => ({ serverUrl, token: 'snapshot-employee' }),
    write: async () => {
      throw new Error('snapshot credentials are fixed')
    },
    clear: async () => {
      throw new Error('snapshot credentials are fixed')
    },
  })
  ctx.effect(() => mountEnterpriseTools(ctx, 1000))
  const prepared = new WeakSet<object>()
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const signal = AbortSignal.timeout(10000)
    while (!ctx.tools.schemas().some(tool => tool.name.startsWith(`lfclaw_${toolName}_`))) {
      await delay(10, undefined, { signal })
    }
    if (!prepared.has(agent)) {
      prepared.add(agent)
      // This HTTP-only fixture never reads the workspace; keep its context independent of host paths.
      agent.ctx.effect(() =>
        agent.ctx.systemPrompt.context({
          name: 'working-directory:current',
          order: ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
          required: true,
          text: 'This connector fixture uses only its local HTTP service; no workspace files are queried.',
        }),
      )
    }
    return next()
  })
}
