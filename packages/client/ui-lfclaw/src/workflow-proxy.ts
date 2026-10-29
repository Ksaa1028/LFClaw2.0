/** 员工令牌只在 Host 内用于固定工作流接口。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-ui-activation'
/** 注册可撤销的工作流代理。
 * @param ctx - 已注入企业连接的 Host。
 */
export function mountWorkflowProxy(ctx: Context): void {
  for (const [operation, path, methods] of [
    ['workflows', 'employee/workflows', ['GET', 'POST']],
    ['workflow-summary', 'employee/workflows/summary', ['POST']],
    ['workflow-pending', 'employee/workflows/pending', ['GET']],
  ] as const) {
    ctx.effect(() => ctx.connection.fetch.register({ path: `/api/lfclaw/${operation}`,
      methods: [...methods], requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const response = await ctx.enterpriseConnection.request(path, {
            method: request.method, signal: request.signal,
            ...(request.method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: await request.text() } : {}),
          })
          return new Response(await response.arrayBuffer(), { status: response.status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
        } catch (error) {
          ctx.logger.warn('Workflow request failed: %s', error instanceof Error ? error.name : 'unknown')
          return Response.json({ code: 'CONNECTION_FAILED' }, { status: 502 })
        }
      },
    }), `lfclaw: ${operation}`)
  }
}
