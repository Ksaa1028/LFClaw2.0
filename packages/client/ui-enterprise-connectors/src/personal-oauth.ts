/** Browser OAuth for personal MCP servers, with a one-use loopback callback and private token storage. */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { PersonalConnectorError, type PersonalConnector } from './personal-store.ts'

interface SavedAuthorization {
  redirectUrl: string
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
}
/** OAuth URLs require TLS except for loopback development endpoints.
 * @param value - URL supplied by a connector or authorization discovery.
 * @returns Validated URL.
 */
function oauthUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new PersonalConnectorError('invalid')
  return url
}
/** Own local OAuth credentials and callback listeners for one Host lifetime. */
export class PersonalOAuth {
  private readonly pending = new Map<string, { server: Server; timer: ReturnType<typeof setTimeout> }>()
  private readonly generations = new Map<string, string>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly callbacks = new Set<Promise<void>>()
  constructor(
    private readonly root: string,
    private readonly timeoutMs: number,
    private readonly flowTtlMs: number,
    private readonly lifetime: AbortSignal,
    private readonly valid: (owner: string, item: PersonalConnector) => Promise<boolean>,
  ) {}
  private key(owner: string, item: PersonalConnector): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          owner,
          item.id,
          item.revision,
          item.url,
          item.auth,
          item.headers,
          item.clientId,
          item.issuer,
          item.scopes,
        ]),
      )
      .digest('hex')
  }
  private path(key: string): string {
    return join(this.root, 'oauth', `${key}.json`)
  }
  private async read(key: string): Promise<SavedAuthorization> {
    let text: string
    try {
      text = await readFile(this.path(key), 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { redirectUrl: '' }
      throw new PersonalConnectorError('storage')
    }
    try {
      const value: unknown = JSON.parse(text)
      if (!value || typeof value !== 'object' || !('redirectUrl' in value) || typeof value.redirectUrl !== 'string')
        throw new Error('invalid')
      const tokens = 'tokens' in value ? OAuthTokensSchema.parse(value.tokens) : undefined
      const client = 'client' in value ? OAuthClientInformationSchema.parse(value.client) : undefined
      return { redirectUrl: oauthUrl(value.redirectUrl).href, ...(tokens ? { tokens } : {}), ...(client ? { client } : {}) }
    } catch {
      throw new PersonalConnectorError('storage')
    }
  }
  private persist(key: string, data: SavedAuthorization, check: () => Promise<void>): Promise<void> {
    const write = (this.writes.get(key) ?? Promise.resolve())
      .catch((_error: unknown) => {
        // The preceding caller receives its failure; this queued write validates the current owner again.
      })
      .then(async () => {
        await check()
        await mkdir(join(this.root, 'oauth'), { recursive: true, mode: 0o700 })
        const temporary = `${this.path(key)}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
        try {
          await check()
          await rename(temporary, this.path(key))
        } catch (error) {
          await unlink(temporary)
          throw error
        }
      })
    this.writes.set(key, write)
    return write
  }
  /** Fetch OAuth metadata and tokens without forwarding credentials through redirects. */
  readonly fetch: typeof fetch = (input, init) =>
    fetch(oauthUrl(input instanceof Request ? input.url : String(input)), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([this.lifetime, AbortSignal.timeout(this.timeoutMs), ...(init?.signal ? [init.signal] : [])]),
    })
  /** Load a provider or begin interactive authorization.
   * @param owner - Authenticated employee.
   * @param item - Saved connector.
   * @param completed - Present only when starting browser authorization; refreshes tools after callback.
   * @returns Runtime SDK provider and an optional browser URL.
   */
  async provider(
    owner: string,
    item: PersonalConnector,
    completed?: () => Promise<void>,
  ): Promise<{ provider: OAuthClientProvider; assertCurrent: () => Promise<void>; authorizationUrl?: string }> {
    oauthUrl(item.url)
    const key = this.key(owner, item)
    if (!this.generations.has(key)) this.generations.set(key, randomUUID())
    if (completed) await this.cancel(key)
    const generation = this.generations.get(key)!
    const data: SavedAuthorization = completed ? { redirectUrl: '' } : await this.read(key)
    const check = async () => {
      if (this.lifetime.aborted || this.generations.get(key) !== generation || !(await this.valid(owner, item)))
        throw new PersonalConnectorError('authorizationRequired')
    }
    let verifier = '',
      authorizationUrl = ''
    const state = randomBytes(32).toString('base64url')
    let discovery: OAuthDiscoveryState | undefined
    let committing = !completed
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return data.redirectUrl || undefined
      },
      get clientMetadata() {
        return {
          client_name: 'LFClaw',
          redirect_uris: data.redirectUrl ? [data.redirectUrl] : [],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }
      },
      state: () => state,
      clientInformation: () => data.client ?? (item.clientId ? { client_id: item.clientId, issuer: item.issuer } : undefined),
      saveClientInformation: async (client) => {
        await check()
        data.client = client
        if (committing) await this.persist(key, data, check)
      },
      tokens: async () => {
        await check()
        return data.tokens
      },
      saveTokens: async (tokens) => {
        await check()
        data.tokens = tokens
        if (committing) await this.persist(key, data, check)
      },
      saveCodeVerifier: (value) => {
        verifier = value
      },
      codeVerifier: () => {
        if (!verifier) throw new PersonalConnectorError('authorizationRequired')
        return verifier
      },
      redirectToAuthorization: async (url) => {
        await check()
        if (!completed) {
          delete data.tokens
          await this.persist(key, data, check)
          throw new PersonalConnectorError('authorizationRequired')
        }
        authorizationUrl = oauthUrl(url.href).href
      },
      saveDiscoveryState: (value) => {
        discovery = value
      },
      discoveryState: () => discovery,
      invalidateCredentials: async (scope) => {
        if (scope === 'tokens' || scope === 'all') delete data.tokens
        if (scope === 'client' || scope === 'all') delete data.client
        if (scope === 'verifier' || scope === 'all') verifier = ''
        if (scope === 'discovery' || scope === 'all') discovery = undefined
        if (committing) await this.persist(key, data, check)
      },
    }
    if (!completed) {
      if (!data.tokens) throw new PersonalConnectorError('authorizationRequired')
      return { provider, assertCurrent: check }
    }
    const server = createServer((request, response) => {
      const handle = async () => {
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Referrer-Policy', 'no-referrer')
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Content-Security-Policy', "default-src 'none'")
        const url = new URL(request.url ?? '/', data.redirectUrl)
        if (request.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
          response.writeHead(400).end('Invalid OAuth callback')
          return
        }
        const code = url.searchParams.get('code')
        const pending = this.pending.get(key)
        if (!pending) {
          response.writeHead(400).end('Authorization expired')
          return
        }
        clearTimeout(pending.timer)
        this.pending.delete(key)
        server.close()
        try {
          if (!code || code.length > 8192 || url.searchParams.has('error'))
            throw new PersonalConnectorError('authorizationRequired')
          await check()
          if ((await auth(provider, { serverUrl: item.url, authorizationCode: code, fetchFn: this.fetch })) !== 'AUTHORIZED')
            throw new PersonalConnectorError('authorizationRequired')
          committing = true
          await this.persist(key, data, check)
          await completed()
          response.end('授权成功，请返回 LFClaw。Authorization complete. Return to LFClaw.')
        } catch {
          response.writeHead(400).end('授权失败或已取消，请返回 LFClaw 重新连接。Authorization failed or cancelled.')
        }
      }
      const work = handle()
      this.callbacks.add(work)
      void work
        .catch(() => {
          response.destroy()
        })
        .finally(() => this.callbacks.delete(work))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new PersonalConnectorError('unavailable')
    }
    data.redirectUrl = `http://127.0.0.1:${address.port}/callback`
    const timer = setTimeout(() => {
      void this.cancel(key)
    }, this.flowTtlMs)
    timer.unref()
    this.pending.set(key, { server, timer })
    try {
      await auth(provider, { serverUrl: item.url, ...(item.scopes ? { scope: item.scopes } : {}), fetchFn: this.fetch })
      await check()
      if (!authorizationUrl) throw new PersonalConnectorError('unavailable')
      return { provider, assertCurrent: check, authorizationUrl }
    } catch (error) {
      await this.cancel(key)
      throw error
    }
  }
  private async cancel(key: string): Promise<void> {
    this.generations.set(key, randomUUID())
    const pending = this.pending.get(key)
    if (!pending) return
    this.pending.delete(key)
    clearTimeout(pending.timer)
    pending.server.closeAllConnections()
    await new Promise<void>(resolve =>
      pending.server.close(() => {
        resolve()
      }),
    )
  }
  /** Disconnect locally and invalidate late token writes.
   * @param owner - Authenticated employee.
   * @param item - Connector to disconnect.
   */
  async remove(owner: string, item: PersonalConnector): Promise<void> {
    const key = this.key(owner, item)
    await this.cancel(key)
    await this.writes.get(key)?.catch((_error: unknown) => {
      // A failed prior write must not prevent removal of the previously committed credentials.
    })
    try {
      await unlink(this.path(key))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new PersonalConnectorError('storage')
    }
  }
  /** Close callbacks and drain private credential writes before Host shutdown. */
  async dispose(): Promise<void> {
    await Promise.all([...this.pending.keys()].map(key => this.cancel(key)))
    await Promise.allSettled([...this.callbacks, ...this.writes.values()])
  }
}
