/** Host 中的企业请求服务；员工凭据不进入渲染层。 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ActivationStorage } from './enterprise.ts'
declare module '@deepseek-ai/cordis' { interface Context { enterpriseConnection: EnterpriseConnection } }
/** 仅使用当前激活服务器的员工令牌访问企业接口。 */
export class EnterpriseConnection extends Service {
  private identity = ''
  private generation = 0
  private readonly catalogs = new Map<string, { body: string; receivedAt: number }>()
  private readonly requests = new Map<string, number>()
  constructor(ctx: Context, private readonly serverUrl: string, private readonly timeoutMs: number, private readonly storage: ActivationStorage) { super(ctx, 'enterpriseConnection') }
  private clearCatalogs(): void {
    this.generation++
    this.catalogs.clear()
    this.requests.clear()
  }
  /**
   * 调用当前员工的企业接口，禁止重定向携带凭据。
   * @param path - 企业 API 下的相对路径，由 Host 调用方提供。
   * @param init - 请求参数；catalogMaxAgeMs 仅允许展示目录复用近期响应，实际授权与执行不使用该选项。
   * @returns 企业接口响应；调用方负责解析数据和处理非成功状态。
   */
  async request(path: string, init: RequestInit & { catalogMaxAgeMs?: number } = {}): Promise<Response> {
    init.signal?.throwIfAborted()
    const value = await this.storage.read()
    if (!value || typeof value !== 'object' || !('serverUrl' in value) || value.serverUrl !== this.serverUrl || !('token' in value) || typeof value.token !== 'string') {
      this.identity = ''; this.clearCatalogs()
      return Response.json({ message: '请先激活企业账号' }, { status: 401 })
    }
    if (this.identity !== value.token) { this.identity = value.token; this.clearCatalogs() }
    const { catalogMaxAgeMs = 0, ...options } = init
    const mutation = options.method !== undefined && options.method !== 'GET' && options.method !== 'HEAD'
      && (/^employee\/connectors\/[^/]+\/(?:credentials|account)$/.test(path)
        || /^employee\/personal-(?:experts(?:\/[^/]+)?|expert-teams)$/.test(path))
    if (mutation) this.clearCatalogs()
    const key = path === 'employee/me' || path === 'employee/expert-catalog' ? path
      : path === 'employee/connector-catalog' || path.startsWith('employee/connector-catalog?revision=') ? 'employee/connector-catalog' : undefined
    const cached = key && path === key && !mutation ? this.catalogs.get(key) : undefined
    if (cached && Date.now() - cached.receivedAt < catalogMaxAgeMs) {
      init.signal?.throwIfAborted()
      return new Response(cached.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
    const generation = this.generation
    const sequence = key ? (this.requests.get(key) ?? 0) + 1 : 0
    if (key) this.requests.set(key, sequence)
    const current = () => generation === this.generation && (!key || this.requests.get(key) === sequence)
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${value.token}`)
    try {
      const response = await fetch(`${this.serverUrl}/${path}`, { ...options, headers, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) })
      if (generation === this.generation && (mutation || response.status === 401 || response.status === 403)) this.clearCatalogs()
      if (key && current()) {
        if (response.ok) {
          const body = await response.clone().text()
          if (current()) this.catalogs.set(key, { body, receivedAt: Date.now() })
        } else this.catalogs.delete(key)
      }
      return response
    } catch (error) {
      if (key && current()) this.catalogs.delete(key)
      throw error
    }
  }
}
