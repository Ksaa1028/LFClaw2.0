/** 企业激活凭据只保存在 Host；页面只接收员工信息与验证结果。 */
export interface ActivationStorage {
  /** @returns 已保存的企业凭据；首次使用返回空值。 */
  read(): Promise<unknown>
  /** @param value - 仅 Host 可读的服务地址和令牌。 @returns 持久化完成。 */
  write(value: { serverUrl: string; token: string }): Promise<void>
  /** @returns 本机凭据清除完成。 */
  clear(): Promise<void>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * 校验企业地址；公网 HTTP 必须由部署配置显式允许。
 * @param value - 部署地址。
 * @param allowInsecureHttp - 是否允许向公网 HTTP 企业地址发送请求。
 * @returns 规范化地址。
 */
export function enterpriseUrl(value: string, allowInsecureHttp = false): string {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && (allowInsecureHttp || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))) {
    throw new Error('LFClaw 企业服务地址必须使用 HTTPS；公网 HTTP 需要显式配置 allowInsecureHttp')
  }
  return url.href.replace(/\/+$/, '')
}

/** 处理经过 DSH Connection 认证的激活请求。 */
export class EnterpriseActivation {
  private pending: Promise<void> = Promise.resolve()
  constructor(private readonly serverUrl: string, private readonly timeoutMs: number,
    private readonly storage: ActivationStorage, private readonly transport: typeof fetch = fetch) {}

  /**
   * 顺序执行登录状态读写，避免退出与激活互相覆盖。
   * @param request - 本机请求。
   * @returns 不包含凭据的响应。
   */
  handle(request: Request): Promise<Response> {
    const operation = this.pending.then(() => this.run(request))
    this.pending = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async run(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname
      if (path.endsWith('/branding')) {
        const response = await this.transport(`${this.serverUrl}/branding`, {
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)]), redirect: 'error',
        })
        if (!response.ok) return this.failure(response.status)
        const value = record(await response.json())
        if (typeof value?.headline !== 'string' || typeof value.badge !== 'string' || typeof value.showBadge !== 'boolean') {
          throw new Error('首页文案响应无效')
        }
        return Response.json({ headline: value.headline, badge: value.badge, showBadge: value.showBadge })
      }
      if (path.endsWith('/logout')) {
        await this.storage.clear()
        return Response.json({ activated: false })
      }
      let token: string
      if (path.endsWith('/activate')) {
        const body = record(await request.json())
        if (typeof body?.code !== 'string' || !body.code.trim() || body.code.length > 128) {
          return Response.json({ message: '请输入有效的员工激活码' }, { status: 400 })
        }
        const response = await this.transport(`${this.serverUrl}/employee/activate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: body.code.trim() }), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
        })
        if (!response.ok) return this.failure(response.status)
        const result = record(await response.json())
        if (typeof result?.token !== 'string' || !result.token) throw new Error('激活响应无效')
        token = result.token
      } else {
        const stored = record(await this.storage.read())
        if (stored?.serverUrl !== this.serverUrl || typeof stored.token !== 'string' || !stored.token) {
          return Response.json({ activated: false })
        }
        token = stored.token
      }
      const response = await this.transport(`${this.serverUrl}/employee/me`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
      })
      if (!response.ok) return this.failure(response.status)
      const employee = record(record(await response.json())?.employee)
      if (typeof employee?.id !== 'string' || typeof employee.name !== 'string') throw new Error('员工响应无效')
      if (path.endsWith('/activate')) await this.storage.write({ serverUrl: this.serverUrl, token })
      return Response.json({ activated: true, employee: { id: employee.id, name: employee.name,
        departmentName: typeof employee.departmentName === 'string' ? employee.departmentName : null } })
    } catch (error) {
      // 不记录上游正文或凭据；网络或持久化失败均不放行界面。
      return Response.json({ message: error instanceof SyntaxError ? '请求或服务响应格式无效' : '无法连接企业服务或保存登录，请检查服务后重试' }, { status: 503 })
    }
  }

  private failure(status: number): Response {
    return Response.json({ activated: false, message: status === 401 || status === 403
      ? '激活码无效、登录已失效或员工已停用，请联系管理员'
      : status === 429 ? '尝试次数过多，请稍后重试' : '企业服务暂不可用，请稍后重试' },
    { status: status === 401 || status === 403 || status === 429 ? status : 503 })
  }
}
