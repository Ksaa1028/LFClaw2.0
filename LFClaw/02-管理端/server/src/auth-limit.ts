/** 管理员登录与员工激活的进程内失败次数限制。 */
export class AuthLimit {
  private readonly failures = new Map<string, { count: number; until: number }>()

  constructor(readonly windowMs: number, readonly loginMaxFailures: number,
    readonly activationMaxFailures: number) {}

  /** 返回仍需等待的秒数；零表示当前可尝试。
   * @param kind 登录或激活接口。
   * @param address 请求来源地址。
   * @returns 剩余等待秒数。
   */
  retryAfter(kind: 'login' | 'activation', address: string): number {
    const key = `${kind}:${address}`
    const entry = this.failures.get(key)
    if (!entry) return 0
    if (entry.until <= Date.now()) { this.failures.delete(key); return 0 }
    if (entry.count < (kind === 'login' ? this.loginMaxFailures : this.activationMaxFailures)) return 0
    return Math.max(1, Math.ceil((entry.until - Date.now()) / 1000))
  }

  /** 记录一次失败尝试。
   * @param kind 登录或激活接口。
   * @param address 请求来源地址。
   */
  failure(kind: 'login' | 'activation', address: string): void {
    const key = `${kind}:${address}`
    const now = Date.now()
    const entry = this.failures.get(key)
    this.failures.set(key, entry && entry.until > now
      ? { count: entry.count + 1, until: entry.until }
      : { count: 1, until: now + this.windowMs })
    for (const [value, current] of this.failures) if (current.until <= now) this.failures.delete(value)
  }

  /** 登录或激活成功后清除对应计数。
   * @param kind 登录或激活接口。
   * @param address 请求来源地址。
   */
  success(kind: 'login' | 'activation', address: string): void {
    this.failures.delete(`${kind}:${address}`)
  }
}
