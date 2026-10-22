/** Registers employee-authorized MCP tools through the enterprise server proxy. */
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { McpToolDefinitionOptions } from '@deepseek-ai/dsh-mcp-client'
import { connectorToolDefinitions, resolveToolCatalogConfig, type ToolCatalogConfig } from './tool-catalog.ts'
import type {} from '@deepseek-ai/dsh-client-ui-activation'
import type {} from '@deepseek-ai/dsh-tools'
import { catalogRevision, parseConnectors, type ConnectorSummary } from './catalog.ts'

interface DiscoveredTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: unknown
}

function discoveredTools(value: unknown, allowed: ReadonlySet<string>): DiscoveredTool[] {
  if (!value || typeof value !== 'object' || !('tools' in value) || !Array.isArray(value.tools))
    throw new Error('invalid tool catalog')
  return value.tools.flatMap((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('name' in raw) ||
      typeof raw.name !== 'string' ||
      !allowed.has(raw.name) ||
      !('inputSchema' in raw) ||
      !raw.inputSchema ||
      typeof raw.inputSchema !== 'object' ||
      Array.isArray(raw.inputSchema)
    )
      return []
    return [
      {
        name: raw.name,
        description: 'description' in raw && typeof raw.description === 'string' ? raw.description : '',
        inputSchema: raw.inputSchema as Record<string, unknown>,
        ...('outputSchema' in raw ? { outputSchema: raw.outputSchema } : {}),
      },
    ]
  })
}

function publicName(connectorId: string, toolName: string): string {
  const digest = createHash('sha256').update(`${connectorId}\0${toolName}`).digest('hex').slice(0, 10)
  const label = toolName.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 35)
  return `lfclaw_${label || 'tool'}_${digest}`
}

/**
 * Keep the runtime tool registry aligned with current employee authorization.
 * @param ctx - Host context with the enterprise connection and tool registry.
 * @param refreshIntervalMs - retry delay after authorization synchronization fails.
 * @param catalogConfig - Optional tool declaration and discovery limits.
 * @returns a disposer that aborts requests and unregisters these tools.
 */
export function mountEnterpriseTools(
  ctx: Context,
  refreshIntervalMs: number,
  catalogConfig: Partial<ToolCatalogConfig> = {},
): () => Promise<void> {
  const limits = resolveToolCatalogConfig(catalogConfig)
  const lifetime = new AbortController()
  let active = new Map<string, () => void>()
  let generation = new AbortController()
  const jobs = new Set<Promise<void>>()
  const clear = () => {
    generation.abort()
    for (const dispose of active.values()) dispose()
    active = new Map()
  }
  const refresh = async (connectors: ConnectorSummary[], signal: AbortSignal) => {
    try {
      const next = []
      for (const connector of connectors) {
        if (connector.tools.length === 0) continue
        const response = await ctx.enterpriseConnection.request(`employee/connectors/${encodeURIComponent(connector.id)}/tools`, {
          signal,
        })
        if (!response.ok) throw new Error(`tool catalog HTTP ${response.status}`)
        const allowed = new Set(connector.tools.map(tool => tool.name))
        for (const tool of discoveredTools(await response.json(), allowed)) next.push({ connector, tool })
      }
      if (signal.aborted) return
      try {
        const grouped = new Map<string, { connector: ConnectorSummary; tools: McpToolDefinitionOptions[] }>()
        for (const { connector, tool } of next) {
          const name = publicName(connector.id, tool.name)
          const definition: McpToolDefinitionOptions = {
            name,
            rawName: tool.name,
            description: `${connector.name}：${tool.description}`,
            inputSchema: tool.inputSchema,
            ...('outputSchema' in tool ? { outputSchema: tool.outputSchema } : {}),
            async call(args, execution) {
              signal.throwIfAborted()
              const response = await ctx.enterpriseConnection.request(
                `employee/connectors/${encodeURIComponent(connector.id)}/call`,
                {
                  method: 'POST',
                  signal: AbortSignal.any([signal, execution.signal]),
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: tool.name, arguments: args }),
                },
              )
              signal.throwIfAborted()
              if (!response.ok) {
                if (response.status === 403) {
                  let failure: unknown
                  try {
                    failure = await response.json()
                  } catch (error) {
                    clear()
                    throw new Error('无法确认连接器权限，请等待权限同步后重试', { cause: error })
                  }
                  if (failure && typeof failure === 'object' && 'code' in failure && failure.code === 'MCP_DATA_FORBIDDEN') {
                    throw new Error(
                      '请求的楼层没有权限或参数无效。请直接查询工具说明中已授权的楼层，并告知其他楼层无权限、无法获取；无需用户扩权或新建会话。',
                    )
                  }
                }
                if (response.status === 401 || response.status === 403) clear()
                throw new Error(response.status === 403 ? '连接器权限已变化，请按最新权限重新查询' : '企业连接器暂不可用')
              }
              const result: unknown = await response.json()
              signal.throwIfAborted()
              return result
            },
          }
          const group = grouped.get(connector.id) ?? { connector, tools: [] }
          group.tools.push(definition)
          grouped.set(connector.id, group)
        }
        for (const { connector, tools } of grouped.values()) {
          for (const definition of connectorToolDefinitions(
            ctx,
            publicName(connector.id, 'catalog'),
            connector.name,
            tools,
            limits,
            () => {
              signal.throwIfAborted()
            },
          )) {
            active.set(definition.name, ctx.tools.register(definition))
          }
        }
      } catch (error) {
        clear()
        throw error
      }
    } catch (error) {
      if (signal.aborted) return
      clear()
      ctx.logger.warn('企业连接器工具同步失败：%s', error instanceof Error ? error.message : 'unknown')
    }
  }
  const watch = async () => {
    let revision = ''
    while (!lifetime.signal.aborted) {
      try {
        const response = await ctx.enterpriseConnection.request(
          `employee/connector-catalog${revision ? `?revision=${revision}` : ''}`,
          { signal: lifetime.signal },
        )
        if (!response.ok) throw new Error(`catalog HTTP ${response.status}`)
        const value: unknown = await response.json()
        const nextRevision = catalogRevision(value)
        const connectors = parseConnectors(value)
        if (lifetime.signal.aborted) return
        if (nextRevision !== revision || generation.signal.aborted) {
          clear()
          generation = new AbortController()
          revision = nextRevision
          const job = refresh(connectors, AbortSignal.any([lifetime.signal, generation.signal]))
          jobs.add(job)
          void job.finally(() => jobs.delete(job))
        }
      } catch (error) {
        clear()
        revision = ''
        if (lifetime.signal.aborted) return
        ctx.logger.warn('企业连接器授权同步失败，已清除旧权限：%s', error instanceof Error ? error.message : 'unknown')
        try {
          await delay(refreshIntervalMs, undefined, { signal: lifetime.signal })
        } catch (error) {
          if (!lifetime.signal.aborted) throw error
        }
      }
    }
  }
  const watching = watch()
  return async () => {
    lifetime.abort()
    clear()
    await watching
    await Promise.all(jobs)
  }
}
