/** Account-scoped personal MCP configuration; secrets are never included in catalog responses. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identifier for one personal connector. */
export type PersonalConnectorId = Branded<'PersonalConnectorId'>
/** Saved MCP configuration owned by one activated employee on this device. */
export interface PersonalConnector {
  id: PersonalConnectorId
  revision: string
  name: string
  enabled: boolean
  transport: 'sse' | 'streamable-http' | 'stdio'
  url: string
  command: string
  args: string[]
  headers: Record<string, string>
  env: Record<string, string>
  auth?: 'manual' | 'oauth'
  clientId?: string
  issuer?: string
  scopes?: string
}
/** Errors whose code can be localized by the client. */
export class PersonalConnectorError extends Error {
  constructor(
    readonly code:
      | 'invalid'
      | 'conflict'
      | 'storage'
      | 'unavailable'
      | 'protected'
      | 'unauthorized'
      | 'transportRejected'
      | 'authorizationRequired',
    readonly connectorName?: string,
  ) {
    super(code)
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalConnectorError('invalid')
  return value as Record<string, unknown>
}
function dictionary(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (value === undefined) return result
  for (const [key, item] of Object.entries(record(value))) {
    if (!key.trim() || typeof item !== 'string' || /[\r\n]/u.test(key) || /[\r\n]/u.test(item))
      throw new PersonalConnectorError('invalid')
    result[key] = item
  }
  return result
}
/** Validate a form or one entry from a common mcpServers JSON document.
 * @param value - untrusted JSON, with saved secrets represented as blank values.
 * @param prior - previous configuration when editing.
 * @returns complete configuration; omitted deployment choices have explicit values.
 */
export function parsePersonalConnector(value: unknown, prior?: PersonalConnector): PersonalConnector {
  const input = record(value)
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 80 ||
    (input.enabled !== undefined && typeof input.enabled !== 'boolean') ||
    (input.disabled !== undefined && typeof input.disabled !== 'boolean')
  )
    throw new PersonalConnectorError('invalid')
  if (prior && input.revision !== prior.revision) throw new PersonalConnectorError('conflict')
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  const transport =
    input.transport ??
    input.type ??
    (command ? 'stdio' : url.endsWith('/sse') || url.endsWith('/sse2') ? 'sse' : 'streamable-http')
  if (transport !== 'stdio' && transport !== 'sse' && transport !== 'streamable-http') throw new PersonalConnectorError('invalid')
  if (input.auth !== undefined && input.auth !== 'manual' && input.auth !== 'oauth') throw new PersonalConnectorError('invalid')
  if (input.auth === 'oauth' && transport === 'stdio') throw new PersonalConnectorError('invalid')
  for (const name of ['clientId', 'issuer', 'scopes'])
    if (
      input[name] !== undefined &&
      (typeof input[name] !== 'string' || input[name].length > 2048 || /[\0\r\n]/.test(input[name]))
    )
      throw new PersonalConnectorError('invalid')
  if (input.clientId && !input.issuer) throw new PersonalConnectorError('invalid')
  if (input.issuer) {
    try {
      const issuer = new URL(String(input.issuer))
      if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.hash) throw new Error('invalid issuer')
    } catch {
      throw new PersonalConnectorError('invalid')
    }
  }
  if (transport !== 'stdio') {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new PersonalConnectorError('invalid')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash)
      throw new PersonalConnectorError('invalid')
    if (input.auth === 'oauth' && parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
      throw new PersonalConnectorError('invalid')
  } else if (!command) throw new PersonalConnectorError('invalid')
  if (input.args !== undefined && (!Array.isArray(input.args) || !input.args.every(item => typeof item === 'string')))
    throw new PersonalConnectorError('invalid')
  const headers = dictionary(input.headers)
  const env = dictionary(input.env)
  const headerNames = new Set<string>()
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(key) ||
      headerNames.has(lower) ||
      ['host', 'cookie', 'content-length', 'x-lfclaw-permission-assertion'].includes(lower)
    )
      throw new PersonalConnectorError('invalid')
    headerNames.add(lower)
    if (input.auth === 'oauth' && lower === 'authorization') throw new PersonalConnectorError('invalid')
  }
  for (const [key, item] of Object.entries(headers)) {
    if (item) continue
    if (!prior || prior.url !== url || !prior.headers[key]) throw new PersonalConnectorError('invalid')
    headers[key] = prior.headers[key]
  }
  for (const [key, item] of Object.entries(env)) {
    if (item) continue
    if (!prior || prior.command !== command || !prior.env[key]) throw new PersonalConnectorError('invalid')
    env[key] = prior.env[key]
  }
  return {
    id: prior?.id ?? brandString<PersonalConnectorId>(randomUUID()),
    revision: randomUUID(),
    name: input.name.trim(),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : input.disabled !== true,
    transport,
    url,
    command,
    args: Array.isArray(input.args) ? input.args : [],
    headers,
    env,
    ...(input.auth ? { auth: input.auth } : {}),
    ...(typeof input.clientId === 'string' ? { clientId: input.clientId } : {}),
    ...(typeof input.issuer === 'string' ? { issuer: input.issuer } : {}),
    ...(typeof input.scopes === 'string' ? { scopes: input.scopes } : {}),
  }
}
/** Remove saved Header and environment values before sending editable metadata to the renderer.
 * @param item - Host-owned configuration.
 * @returns metadata with blank secret fields.
 */
export function publicPersonalConnector(item: PersonalConnector): PersonalConnector {
  return {
    ...item,
    headers: Object.fromEntries(Object.keys(item.headers).map(key => [key, ''])),
    env: Object.fromEntries(Object.keys(item.env).map(key => [key, ''])),
  }
}
/** Atomic local persistence, partitioned by an employee identifier supplied by the enterprise service. */
export class PersonalConnectorStore {
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly root: string) {}
  private path(employee: string): string {
    return join(this.root, `${createHash('sha256').update(employee).digest('hex')}.json`)
  }
  /** Read one employee's configurations; corrupted files stay intact and fail visibly.
   * @param employee - authenticated employee identifier.
   * @returns validated saved configurations.
   */
  async list(employee: string): Promise<PersonalConnector[]> {
    let text: string
    try {
      text = await readFile(this.path(employee), 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw new PersonalConnectorError('storage')
    }
    try {
      const data: unknown = JSON.parse(text)
      if (!Array.isArray(data)) throw new PersonalConnectorError('storage')
      const ids = new Set<string>()
      return data.map((item: unknown) => {
        const saved = record(item)
        if (
          typeof saved.id !== 'string' ||
          !saved.id ||
          ids.has(saved.id) ||
          typeof saved.revision !== 'string' ||
          !saved.revision ||
          typeof saved.enabled !== 'boolean' ||
          !['stdio', 'sse', 'streamable-http'].includes(String(saved.transport)) ||
          typeof saved.url !== 'string' ||
          typeof saved.command !== 'string' ||
          !Array.isArray(saved.args) ||
          !saved.headers ||
          !saved.env
        )
          throw new PersonalConnectorError('storage')
        ids.add(saved.id)
        return { ...parsePersonalConnector(saved), id: brandString<PersonalConnectorId>(saved.id), revision: saved.revision }
      })
    } catch {
      throw new PersonalConnectorError('storage')
    }
  }
  /** Serialize a read-modify-write operation and replace the file only after a complete write.
   * @param employee - authenticated employee identifier.
   * @param change - synchronous change of the current configurations.
   * @returns committed configurations.
   */
  update(employee: string, change: (items: PersonalConnector[]) => PersonalConnector[]): Promise<PersonalConnector[]> {
    const work = this.queue.then(async () => {
      const next = change(await this.list(employee))
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const path = this.path(employee)
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
      return next
    })
    this.queue = work.then(
      () => {},
      () => {},
    )
    return work
  }
}
