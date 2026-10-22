/** MCP SDK OAuth 会话：凭据按连接器和账号归属隔离，回调只能使用一次。 */
import { randomBytes, randomUUID } from 'node:crypto'
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import { OAuthClientInformationFullSchema, type OAuthClientInformationMixed, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { accountConfiguration, connectorAccount, type ConnectorAccount } from './connector-account.ts'
import { connectorAuthentication } from './connector-auth-config.ts'
import type { JsonStore, RecordItem } from './store.ts'

export class ConnectorAuthorizationRequired extends Error {
  constructor() { super('连接器需要重新授权') }
}
interface Pending {
  state: string
  redirectUrl: string
  loopback: boolean
  connector: RecordItem
  account: ConnectorAccount
  expiresAt: number
  verifier: string
  authorizationUrl?: string
  discovery?: OAuthDiscoveryState
  check: () => void
}
/** URL 仅接受 HTTPS；本机开发允许 HTTP loopback。 */
export function validOAuthUrl(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password || url.hash || !(url.protocol === 'https:'
    || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('OAuth 需要 HTTPS 地址')
  return url
}

/** 管理授权开始、一次性回调和调用期间的令牌续期。 */
export class ConnectorOAuth {
  private readonly pending = new Map<string, Pending>()
  private readonly active = new Map<string, string>()
  private readonly revisions = new Map<string, string>()
  private readonly cleanup = new Map<string, () => void>()
  constructor(private readonly store: JsonStore, readonly callbackUrl: string,
    private readonly timeoutMs: number, private readonly flowTtlMs: number, private readonly signal?: AbortSignal) {
    if (callbackUrl) validOAuthUrl(callbackUrl)
    signal?.addEventListener('abort', () => {
      for (const dispose of this.cleanup.values()) dispose()
      this.cleanup.clear(); this.pending.clear(); this.active.clear()
    }, { once: true })
  }
  private key(connector: RecordItem, ownerId: string): string {
    return JSON.stringify([connector.id, connectorAuthentication(connector).owner, ownerId])
  }
  cancel(connector: RecordItem, ownerId: string): void {
    const key = this.key(connector, ownerId)
    this.revisions.set(key, randomUUID())
    this.active.delete(key)
    this.cleanup.get(key)?.()
    this.cleanup.delete(key)
    for (const [state, pending] of this.pending) if (this.key(pending.connector, pending.account.employeeId) === key) this.pending.delete(state)
  }
  /** 撤销或开始新授权会使尚未保存的凭据检查失效。 */
  revision(connector: RecordItem, ownerId: string): string | undefined { return this.revisions.get(this.key(connector, ownerId)) }
  private fetch: typeof fetch = async (input, init) => {
    const url = validOAuthUrl(input instanceof Request ? input.url : String(input))
    return fetch(url, { ...init, redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(this.signal ? [this.signal] : []), ...(init?.signal ? [init.signal] : [])]) })
  }
  private checkConfiguration(pending: Pending): void {
    this.signal?.throwIfAborted()
    pending.check()
    if (pending.state && this.active.get(this.key(pending.connector, pending.account.employeeId)) !== pending.state) {
      throw new ConnectorAuthorizationRequired()
    }
    const current = this.store.read().connectors.find(item => item.id === pending.connector.id)
    if (!current || accountConfiguration(current) !== pending.account.configuration || current.enabled !== true) {
      throw new ConnectorAuthorizationRequired()
    }
  }
  private provider(pending: Pending, persist: boolean): OAuthClientProvider {
    const authentication = connectorAuthentication(pending.connector)
    const clientInformation = () => pending.account.client ?? (authentication.clientId
      ? { client_id: authentication.clientId, issuer: authentication.issuer } : undefined)
    const assertCurrent = () => {
      this.checkConfiguration(pending)
      if (persist && connectorAccount(this.store.read(), pending.connector, pending.account.employeeId)?.revision !== pending.account.revision) {
        throw new ConnectorAuthorizationRequired()
      }
    }
    const save = () => {
      if (!persist) return
      assertCurrent()
      this.store.update(db => {
        const account = connectorAccount(db, pending.connector, pending.account.employeeId)
        if (!account || account.revision !== pending.account.revision) throw new ConnectorAuthorizationRequired()
        Object.assign(account, pending.account)
      })
    }
    return {
      redirectUrl: pending.redirectUrl || undefined,
      clientMetadata: { client_name: 'LFClaw', redirect_uris: pending.redirectUrl ? [pending.redirectUrl] : [],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
      state: () => pending.state,
      clientInformation,
      saveClientInformation: (client: OAuthClientInformationMixed) => { assertCurrent(); pending.account.client = client; save() },
      tokens: () => { assertCurrent(); return pending.account.needsAuthorization ? undefined : pending.account.tokens },
      saveTokens: (tokens: OAuthTokens) => {
        assertCurrent(); pending.account.tokens = tokens; pending.account.needsAuthorization = false
        const client = clientInformation()
        // The SDK needs the grant's redirect metadata to select refresh-token flow after restart.
        if (client && pending.redirectUrl) pending.account.client = { ...client, redirect_uris: [pending.redirectUrl] }
        if (tokens.expires_in !== undefined) pending.account.expiresAt = Date.now() + tokens.expires_in * 1000
        save()
      },
      redirectToAuthorization: url => {
        assertCurrent()
        if (persist) {
          pending.account.needsAuthorization = true; save()
          throw new ConnectorAuthorizationRequired()
        }
        pending.authorizationUrl = validOAuthUrl(url.href).href
      },
      saveCodeVerifier: verifier => { pending.verifier = verifier },
      codeVerifier: () => { if (!pending.verifier) throw new ConnectorAuthorizationRequired(); return pending.verifier },
      saveDiscoveryState: discovery => { pending.discovery = discovery },
      discoveryState: () => pending.discovery,
      invalidateCredentials: scope => {
        if (scope === 'client' || scope === 'all') delete pending.account.client
        if (scope === 'tokens' || scope === 'all') {
          // 保留旧令牌记录以便公开“需重新授权”；它不会再被用于请求。
          pending.account.needsAuthorization = true
          if (!persist) delete pending.account.tokens
          save()
        }
        if (scope === 'verifier' || scope === 'all') pending.verifier = ''
        if (scope === 'discovery' || scope === 'all') delete pending.discovery
      },
    }
  }
  /** 创建新的授权请求，替代同一账号未完成的请求。 */
  async start(connector: RecordItem, ownerId: string, check: () => void, loopbackUrl?: string): Promise<{ authorizationUrl: string; state: string }> {
    const redirectUrl = loopbackUrl ?? this.callbackUrl
    if (!redirectUrl) throw new Error('OAuth 回调地址未配置')
    if (loopbackUrl !== undefined) {
      const url = validOAuthUrl(loopbackUrl)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '0'
        || !/^\/callback\/[a-f0-9]{32}$/.test(url.pathname) || url.search) throw new Error('本机回调地址无效')
    }
    validOAuthUrl(String(connector.endpoint))
    for (const [key, pending] of this.pending) if (pending.expiresAt < Date.now()) this.pending.delete(key)
    if (this.pending.size >= 1024) throw new Error('待授权请求过多')
    this.cancel(connector, ownerId)
    const state = randomBytes(32).toString('base64url')
    const pending: Pending = { state, redirectUrl, loopback: loopbackUrl !== undefined, connector, check, verifier: '', expiresAt: Date.now() + this.flowTtlMs,
      account: { employeeId: ownerId, connectorId: connector.id, owner: connectorAuthentication(connector).owner,
        configuration: accountConfiguration(connector), revision: randomUUID(), values: {} } }
    this.pending.set(state, pending)
    const key = this.key(connector, ownerId)
    this.active.set(key, state)
    const unsubscribe = this.store.subscribe(() => {
      try { this.checkConfiguration(pending) }
      catch (_error) {
        // A revoked flow remains invalid even if an administrator subsequently restores access.
        this.cancel(connector, ownerId)
      }
    })
    const timer = setTimeout(() => this.cancel(connector, ownerId), this.flowTtlMs)
    timer.unref()
    this.cleanup.set(key, () => { unsubscribe(); clearTimeout(timer) })
    try {
      await auth(this.provider(pending, false), { serverUrl: String(connector.endpoint),
        ...(connectorAuthentication(connector).scopes ? { scope: connectorAuthentication(connector).scopes } : {}), fetchFn: this.fetch })
      this.checkConfiguration(pending)
      if (this.pending.get(state) !== pending || !pending.authorizationUrl) throw new ConnectorAuthorizationRequired()
      return { authorizationUrl: pending.authorizationUrl, state }
    } catch (error) {
      if (this.active.get(key) === state) this.cancel(connector, ownerId)
      throw error
    }
  }
  /** 消费 state 后交换授权码；配置、身份或分配范围变化则拒绝提交。 */
  async complete(state: string, code: string, binding?: { connectorId: string; ownerId: string }): Promise<{ connector: RecordItem; account: ConnectorAccount; provider: OAuthClientProvider; check: () => void }> {
    const pending = this.pending.get(state)
    if (!pending || pending.loopback !== (binding !== undefined)
      || binding && (pending.connector.id !== binding.connectorId || pending.account.employeeId !== binding.ownerId)) {
      throw new ConnectorAuthorizationRequired()
    }
    this.pending.delete(state)
    if (!pending || pending.expiresAt < Date.now() || !code || code.length > 8192) throw new ConnectorAuthorizationRequired()
    this.checkConfiguration(pending)
    const provider = this.provider(pending, false)
    const result = await auth(provider, { serverUrl: String(pending.connector.endpoint), authorizationCode: code, fetchFn: this.fetch })
    if (result !== 'AUTHORIZED' || !pending.account.tokens) throw new ConnectorAuthorizationRequired()
    this.checkConfiguration(pending)
    return { connector: pending.connector, account: pending.account, provider, check: () => this.checkConfiguration(pending) }
  }
  /** 返回已保存账号的 SDK Provider；续期不能恢复已解除或已换绑的账号。 */
  forAccount(connector: RecordItem, account: ConnectorAccount): OAuthClientProvider {
    const client = OAuthClientInformationFullSchema.safeParse(account.client)
    const redirectUrl = client.success ? client.data.redirect_uris[0] ?? this.callbackUrl : this.callbackUrl
    if (redirectUrl) validOAuthUrl(redirectUrl)
    const pending: Pending = { state: '', redirectUrl, loopback: false, connector, account: structuredClone(account), check: () => {},
      expiresAt: 0, verifier: '' }
    return this.provider(pending, true)
  }
  get fetchFn(): typeof fetch { return this.fetch }
}
