import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
/** 将删除操作注册到工作区已有会话菜单。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DeleteSessionDialog, DeleteSessionMenu, type DeleteTarget, type DeleteInjected } from './DeleteSession.tsx'
import { zh, en, type SessionActionsKey } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { sessionActions: SessionActionsKey } }
/** 菜单及会话目录依赖。 */
export const inject = ['slots', 'locale', 'sessions']
/** 注册菜单和独立确认框。 @param ctx - 客户端上下文。 */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const pending = createSnapshotStore<DeleteTarget | null>(null)
  ctx.effect(() => ctx.locale.register('sessionActions', { zh, en }), 'session delete locale')
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item', id: 'delete', order: 500, locale: 'sessionActions',
    inject: () => ({ requestDelete: (target: DeleteTarget) => { pending.set(target) } }),
  }, DeleteSessionMenu))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'session-delete-confirm', locale: 'sessionActions', inject: (): DeleteInjected => ({
      hooks: { pending }, settle: () => { pending.set(null) },
      remove: async (sessionId) => {
        const response = await fetch('/api/sessions/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) })
        if (!response.ok) throw new Error('delete-failed')
        await sessions.refresh().catch((error: unknown) => { ctx.logger.warn('会话已删除，刷新列表失败：%s', String(error)) })
      },
    }),
  }, DeleteSessionDialog))
}
