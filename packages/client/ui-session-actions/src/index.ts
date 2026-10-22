/** 受本机连接认证保护的会话删除入口。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
/** 删除接口依赖。 */
export const inject = ['connection', 'sessionController']
/** 注册明确确认后调用的删除接口。 @param ctx - Host 上下文。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/sessions/delete', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let value: unknown
      try { value = await request.json() }
      catch (_error) { return Response.json({ code: 'invalid' }, { status: 400 }) }
      if (!value || typeof value !== 'object' || !('sessionId' in value) || typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 200) return Response.json({ code: 'invalid' }, { status: 400 })
      try {
        await ctx.sessionController.deleteSession(brandString<SessionId>(value.sessionId))
        return new Response(null, { status: 204 })
      } catch (error) {
        ctx.logger.warn('会话删除失败：%s', error instanceof Error ? error.message : 'unknown')
        return Response.json({ code: 'failed' }, { status: 409 })
      }
    },
  }), 'session delete HTTP')
}
