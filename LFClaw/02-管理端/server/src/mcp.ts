/** 企业商场权限计算与服务端 MCP 连接。 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Database, RecordItem } from './store.ts'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

export const mallPermissionIds = [
  'operation.floor.1', 'operation.floor.2', 'operation.floor.3',
  'operation.floor.4', 'operation.self_operated',
] as const

export type MallPermissionId = typeof mallPermissionIds[number]

/** Read the explicit data-permission switch, including previously saved authentication settings. */
export function usesMallDataPermissions(connector: RecordItem): boolean {
  return typeof connector.mallDataPermissions === 'boolean' ? connector.mallDataPermissions : connector.authMode === 'mall'
}

function isMallPermissionId(value: unknown): value is MallPermissionId {
  return typeof value === 'string' && (mallPermissionIds as readonly string[]).includes(value)
}

/** Only employee selections grant mall data access; missing or invalid settings deny access. */
export function permissionsForEmployee(_db: Database, employee: RecordItem): MallPermissionId[] {
  const stored = employee.mcpPermissions
  return validMallPermissions(stored) ? mallPermissionIds.filter(id => stored.includes(id)) : []
}

/** Accept any unique combination of the five mall permissions; an empty array denies all. */
export function validMallPermissions(value: unknown): value is MallPermissionId[] {
  return Array.isArray(value) && value.every(isMallPermissionId)
    && new Set(value).size === value.length
}

export type RemoteMcpTransport = 'sse' | 'streamable-http'

export interface RemoteMcpConnection {
  authProvider?: OAuthClientProvider
  fetch?: typeof fetch
  signal?: AbortSignal
  endpoint: string
  transport: RemoteMcpTransport
  headers: Record<string, string>
  timeoutMs: number
}

export type McpConnection = RemoteMcpConnection | {
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
}

/** Validate a remote MCP URL and server-owned request headers before connecting. */
export function remoteMcpEndpoint(value: string): URL {
  const endpoint = new URL(value)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('MCP 地址必须是无内嵌凭据的 HTTP(S) URL')
  }
  return endpoint
}

/** Open one MCP operation; stdio inherits only the SDK's allowlisted environment plus configured values. */
export async function withMcp<T>(connection: McpConnection, use: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'lfclaw-enterprise', version: '0.1.0' })
  const signal = AbortSignal.any([AbortSignal.timeout(connection.timeoutMs), ...(connection.signal ? [connection.signal] : [])])
  signal.throwIfAborted()
  const transport = connection.transport === 'stdio'
    ? new StdioClientTransport({ command: connection.command, args: connection.args, env: connection.env, stderr: 'ignore' })
    : connection.transport === 'streamable-http'
      ? new StreamableHTTPClientTransport(remoteMcpEndpoint(connection.endpoint),
        { ...(connection.authProvider ? { authProvider: connection.authProvider } : {}),
          ...(connection.fetch ? { fetch: connection.fetch } : {}),
          requestInit: { headers: connection.headers, redirect: 'error', signal } })
      : new SSEClientTransport(remoteMcpEndpoint(connection.endpoint),
        { ...(connection.authProvider ? { authProvider: connection.authProvider } : {}),
          ...(connection.fetch ? { fetch: connection.fetch } : {}),
          requestInit: { headers: connection.headers, redirect: 'error', signal } })
  let closing: Promise<void> | undefined
  const close = () => closing ??= client.close()
  const aborted = () => { void close().catch(error => { console.error('MCP 中断清理失败:', error instanceof Error ? error.name : 'unknown') }) }
  signal.addEventListener('abort', aborted, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([client.connect(transport), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('MCP 连接超时')), connection.timeoutMs)
    })])
    if (timer) clearTimeout(timer)
    signal.throwIfAborted()
    const result = await use(client)
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', aborted)
    if (timer) clearTimeout(timer)
    await close()
  }
}

/** Read a server's tool catalog without calling its tools. */
export async function discoverMcpTools(connection: McpConnection): Promise<{ name: string; description?: string }[]> {
  return withMcp(connection, async client => {
    const result = await client.listTools(undefined, { timeout: connection.timeoutMs })
    return result.tools.map(tool => ({ name: tool.name, description: tool.description }))
  })
}
