/** 技能中心的桌面主面板和侧栏入口。 */
import { createElement, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import { skillDraft } from './skill-draft.ts'
import type { StartSessionOptions } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SkillsPage } from './SkillsPage.tsx'
import { zh, en, type SkillCenterKey } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { skillCenter: SkillCenterKey } }
const PANEL = brandString<MainPanelId>('lfclaw-skills')
/** 服务依赖。 */
export const inject = ['slots', 'locale', 'layout', 'uiWorkspace']
function Icon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode { return createElement(IconSkillOutlineRegular, { size }) }
/** 注册技能入口。 @param ctx - 客户端上下文。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('skillCenter', { zh, en }), 'lfclaw: skill dictionaries')
  const t = ctx.locale.bind('skillCenter')
  ctx.inject(['remote'], (scope) => {
    scope.remote.$on('skills/change', () => { window.dispatchEvent(new Event('lfclaw-skills-changed')) })
  })
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(() => scope.commandUi.hideFromMenu('compact'), 'lfclaw: hide manual compaction command')
    scope.effect(() => scope.commandUi.hideFromMenu('model'), 'lfclaw: hide redundant model command')
    scope.effect(() => scope.commandUi.hideFromMenu('permission'), 'lfclaw: hide redundant permission command')
    scope.effect(() => scope.commandUi.register({
      name: 'skill',
      label: () => t('addSkill'),
      description: () => t('addSkillDescription'),
      icon: IconSkillOutlineRegular,
      available: () => true,
      ui: {
        kind: 'popupSelect',
        searchMode: 'fuzzy-label',
        searchLabels: () => ({ placeholder: t('search'), empty: t('emptySkills'), noResults: t('noMatches') }),
        async options(_session, signal) {
          const response = await fetch('/api/lfclaw/skill-center?wait=1', { signal })
          if (!response.ok) throw new Error(t('unavailable'))
          const catalog: unknown = await response.json()
          if (!catalog || typeof catalog !== 'object' || !('enterprise' in catalog) || !('personal' in catalog)
            || !Array.isArray(catalog.enterprise) || !Array.isArray(catalog.personal)) throw new Error(t('unavailable'))
          return [...catalog.enterprise.map((item: unknown) => ({ item, group: t('enterprise') })),
            ...catalog.personal.map((item: unknown) => ({ item, group: t('personal') }))]
            .flatMap(({ item, group }) => {
              if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string'
                || !('invocationName' in item) || typeof item.invocationName !== 'string'
                || ('enabled' in item && item.enabled === false) || ('userInvocable' in item && item.userInvocable === false)
                || ('error' in item && item.error === true)) return []
              return [{ id: item.invocationName, label: item.name, group: { name: group, label: group } }]
            })
        },
        onSelect(option) {
          ctx.uiWorkspace.startSession(undefined, { prompt: skillDraft(option.label, option.id), reuseBlank: false })
        },
      },
    }), 'lfclaw: skill picker')
  })
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: 'skillCenter', inject: () => ({ startChat: (prompt: NonNullable<StartSessionOptions['prompt']>) =>{  ctx.uiWorkspace.startSession(undefined, { prompt, reuseBlank: false }) } }) }, SkillsPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 45, label: () => t('title'), locale: 'skillCenter' }, Icon))
}
