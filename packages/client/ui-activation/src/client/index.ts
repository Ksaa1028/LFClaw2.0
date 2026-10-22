export type {} from '../continuation-types.ts'
import type {} from '../continuation-types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { HeroText } from './HeroText.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EmployeeBadge } from './EmployeeBadge.tsx'
import { signOutEmployee } from './sign-out.ts'
import type { EmployeeProfile } from './employee.ts'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ActivationPage } from './pages/ActivationPage.tsx'
import { en, zh, type ActivationLocaleKey } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    activation: ActivationLocaleKey
  }
}
export const inject = ['slots', 'locale']
/** 注册企业激活页面。 @param ctx - 客户端上下文。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('activation', { zh, en }), 'lfclaw: dictionaries')
  ctx.slots.inject('conversation.hero.brand.text', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.text', locale: 'activation' }, HeroText),
  )
  const profile = createSnapshotStore<EmployeeProfile | null>(null)
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'lfclaw-employee',
        locale: 'activation',
        inject: () => ({
          hooks: { employee: profile },
          signOut: () =>
            signOutEmployee(() => {
              window.location.reload()
            }),
        }),
      },
      EmployeeBadge,
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'lfclaw-activation',
        locale: 'activation',
        inject: () => ({
          onEmployee: (employee: EmployeeProfile | null) => {
            profile.set(employee)
          },
        }),
      },
      ActivationPage,
    ),
  )
}
