/** Employee OAuth relay; only the enterprise server exchanges and stores tokens. */
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

interface Flow {
  server: Server
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  state: string
  claimed: boolean
}

/** Own one-use browser callback listeners and drain them on Host disposal. */
export class EnterpriseOAuthRelay {
  private readonly flows = new Map<string, Flow>()
  private readonly work = new Set<Promise<unknown>>()
  private disposed = false
  constructor(
    private readonly request: (path: string, init: RequestInit) => Promise<Response>,
    private readonly timeoutMs: number,
    private readonly flowTtlMs: number,
  ) {}

  private track<T>(work: Promise<T>): Promise<T> {
    this.work.add(work)
    void work
      .finally(() => this.work.delete(work))
      .catch((_error: unknown) => {
        // The request or callback owner reports its failure.
      })
    return work
  }

  /** Abort a local flow when the employee disconnects or starts another attempt.
   * @param id - Enterprise connector identifier.
   */
  cancel(id: string): void {
    const flow = this.flows.get(id)
    if (!flow) return
    this.flows.delete(id)
    clearTimeout(flow.timer)
    flow.controller.abort()
    flow.server.closeAllConnections()
    this.track(
      new Promise<void>(resolve =>
        flow.server.close(() => {
          resolve()
        }),
      ),
    )
  }

  /** Start a callback bound to this connector and its displayed configuration.
   * @param id - Enterprise connector identifier.
   * @param configuration - Server-issued configuration digest.
   * @param signal - Cancellation of the initiating client request.
   * @returns Browser authorization URL or a sanitized server failure.
   */
  start(id: string, configuration: string, signal: AbortSignal): Promise<Response> {
    return this.track(this.startFlow(id, configuration, signal))
  }

  private async startFlow(id: string, configuration: string, signal: AbortSignal): Promise<Response> {
    if (this.disposed) throw new Error('OAuth relay disposed')
    signal.throwIfAborted()
    this.cancel(id)
    const path = `/callback/${randomBytes(16).toString('hex')}`
    const controller = new AbortController()
    let callbackUrl = ''
    const server = createServer((req, res) => {
      const handle = async () => {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Referrer-Policy', 'no-referrer')
        res.setHeader('Content-Security-Policy', "default-src 'none'")
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        const url = new URL(req.url ?? '/', callbackUrl)
        if (
          req.method !== 'GET' ||
          req.headers.host !== new URL(callbackUrl).host ||
          url.pathname !== path ||
          !flow.state ||
          url.searchParams.getAll('state').length !== 1 ||
          url.searchParams.get('state') !== flow.state ||
          flow.claimed ||
          this.flows.get(id) !== flow
        ) {
          res.writeHead(400).end('Invalid or expired OAuth callback')
          return
        }
        flow.claimed = true
        server.close()
        try {
          const code = url.searchParams.get('code')
          if (!code || code.length > 8192 || url.searchParams.getAll('code').length !== 1 || url.searchParams.has('error')) {
            throw new Error('Authorization declined or invalid')
          }
          const response = await this.request(`employee/connectors/${encodeURIComponent(id)}/credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]),
            body: JSON.stringify({ operation: 'oauth-complete', configuration, state: flow.state, code }),
          })
          const result: unknown = await response.json()
          if (!response.ok || !result || typeof result !== 'object' || !('configured' in result) || result.configured !== true) {
            throw new Error('Enterprise authorization not confirmed')
          }
          res.end('授权成功，工具已就绪。请返回 LFClaw。Authorization complete. Return to LFClaw.')
        } catch {
          res.writeHead(400).end('授权未确认或已取消，请返回 LFClaw 刷新连接状态后重试。Authorization not confirmed.')
        } finally {
          if (this.flows.get(id) === flow) this.flows.delete(id)
          clearTimeout(flow.timer)
          controller.abort()
        }
      }
      void this.track(handle()).catch(() => res.destroy())
    })
    const timer = setTimeout(() => {
      if (this.flows.get(id) === flow) this.cancel(id)
    }, this.flowTtlMs)
    timer.unref()
    const flow: Flow = { server, controller, timer, state: '', claimed: false }
    this.flows.set(id, flow)
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      controller.signal.throwIfAborted()
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('OAuth listener unavailable')
      callbackUrl = `http://127.0.0.1:${address.port}${path}`
      const upstream = await this.request(`employee/connectors/${encodeURIComponent(id)}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(this.timeoutMs)]),
        body: JSON.stringify({ operation: 'oauth-loopback', configuration, callbackUrl }),
      })
      if (!upstream.ok) {
        if (this.flows.get(id) === flow) this.cancel(id)
        const failure: unknown = await upstream.json()
        const missingCallback =
          failure !== null && typeof failure === 'object' && 'code' in failure && failure.code === 'OAUTH_CALLBACK_UNAVAILABLE'
        return Response.json(
          {
            code:
              upstream.status === 400
                ? 'OAUTH_SERVER_UPDATE_REQUIRED'
                : missingCallback
                  ? 'OAUTH_CALLBACK_UNAVAILABLE'
                  : 'ACCOUNT_CONNECTION_FAILED',
          },
          { status: upstream.status, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      const result: unknown = await upstream.json()
      if (
        !result ||
        typeof result !== 'object' ||
        !('authorizationUrl' in result) ||
        typeof result.authorizationUrl !== 'string' ||
        !('state' in result) ||
        typeof result.state !== 'string' ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(result.state)
      ) {
        throw new Error('Invalid enterprise OAuth response')
      }
      const url = new URL(result.authorizationUrl)
      if (url.username || url.password || url.hash || url.protocol !== 'https:') throw new Error('Invalid authorization URL')
      signal.throwIfAborted()
      controller.signal.throwIfAborted()
      flow.state = result.state
      return Response.json({ authorizationUrl: url.href }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (this.flows.get(id) === flow) this.cancel(id)
      throw error
    }
  }

  /** Abort pending requests and wait for every callback and listener to close. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const id of this.flows.keys()) this.cancel(id)
    while (this.work.size) await Promise.allSettled([...this.work])
  }
}
