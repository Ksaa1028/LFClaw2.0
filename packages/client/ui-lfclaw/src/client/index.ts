/** 员工专家面板注册在 DSH 客户端，个人专家从企业服务读取。 */
import { createElement, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { loadExperts, prepareExpert } from './api.ts'
import { expertConversation } from './expert-conversation.ts'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { expertReferenceDraft, parseExpertReference } from './expert-reference.ts'
import { expertManagerDraft } from './manager-draft.ts'
import { IconAgentPresetOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ExpertsPage } from './ExpertsPage.tsx'
import { ExpertFeedback } from './ExpertFeedback.tsx'
import { zh, en, type LfclawLocaleKey } from './locales.ts'
import { registerSharing } from './sharing-registration.tsx'
import z from '@deepseek-ai/schemastery'

/** Share inbox refresh policy. */
export interface Config {
  /** Interval in milliseconds between synchronized share notification queries. */
  shareRefreshIntervalMs: number
}
/** Validate the share notification polling interval. */
export const Config: z<Config> = z.object({ shareRefreshIntervalMs: z.number().step(1).min(1000).default(30000) })

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** LFClaw 员工专家界面文案。 */
    lfclaw: LfclawLocaleKey
  }
}

const NS = 'lfclaw'
const PANEL_ID = 'lfclaw-experts' as MainPanelId

/** 员工专家入口图标。 @param props - 侧栏请求的尺寸。 @returns 专家图标。 */
function ExpertsIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return createElement(IconAgentPresetOutlineRegular, { size })
}

/** LFClaw 品牌图标。 @param props - 宿主指定的尺寸与布局类名。 @returns 透明金色蟹钳图标。 */
function BrandMark({ size, className }: { size: number; className?: string | undefined }): ReactNode {
  return createElement('img', {
    'data-lfclaw-logo': 'auto',
    src: './assets/lfclaw-logo.svg',
    width: size,
    height: size,
    className,
    alt: '',
  })
}

/** Render the localized LFClaw product name. @param props - Brand dictionary. @returns Product wordmark. */
function BrandName({ t }: PropsLocale<'lfclaw'>): ReactNode {
  return createElement('span', { 'data-lfclaw-brand': 'name' }, t('brandName'))
}

/** 页面依赖服务。 */
export const inject = ['slots', 'locale', 'layout', 'uiWorkspace']

/** Override default brand marks and register the expert panel and sidebar entry. @param ctx - Client plugin context. @param config - Share notification refresh settings. */
export function apply(ctx: Context, config: Config = { shareRefreshIntervalMs: 30000 }): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lfclaw: dictionaries')
  const t = ctx.locale.bind(NS)
  const listeners = new Set<(text: string) => void>()
  const notify = (text: string) => {
    for (const listener of listeners) listener(text)
  }
  const subscribe = (listener: (text: string) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  ctx.inject(['sessions'], (scope) => {
    registerSharing(scope, config.shareRefreshIntervalMs, notify)
  })
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'lfclaw-expert-feedback', inject: () => ({ subscribe }) }, ExpertFeedback),
  )
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, BrandMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', priority: -1, locale: NS }, BrandName),
  )
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, BrandMark),
  )
  ctx.inject(['inputTriggers'], (scope) => {
    scope.effect(
      () =>
        scope.inputTriggers.registerSource({
          trigger: '@',
          name: 'lfclaw-expert',
          candidates: async () => [],
          onPick: () => undefined,
          codec: {
            clipboardText: ref => '@' + parseExpertReference(ref).name,
            async serialize(ref, signal) {
              signal.throwIfAborted()
              const { owner, id } = parseExpertReference(ref)
              const expert = await prepareExpert(owner, id)
              const prompt = await expertConversation(expert, '', t)
              signal.throwIfAborted()
              const skills = prompt.references.map(reference => reference.ref + '\n').join('')
              return (
                skills +
                '<lfclaw-expert>' +
                JSON.stringify({ name: expert.name, configuration: prompt.text.slice(skills.length) }).replaceAll('<', '\u003c') +
                '</lfclaw-expert>'
              )
            },
          },
        }),
      'lfclaw: expert reference codec',
    )
  })
  ctx.inject(['commandUi', 'sessions', 'conversation'], (scope) => {
    for (const kind of ['expert', 'team'] as const)
      scope.effect(
        () =>
          scope.commandUi.register({
            name: kind,
            label: () => t(kind === 'team' ? 'team' : 'single'),
            description: () => t(kind === 'team' ? 'pickTeam' : 'pickExpert'),
            icon: kind === 'team' ? IconUsersOutlineRegular : IconAgentPresetOutlineRegular,
            available: () => true,
            ui: {
              kind: 'popupSelect',
              searchMode: 'fuzzy-label',
              searchLabels: () => ({ placeholder: t('search'), empty: t('noMatches'), noResults: t('noMatches') }),
              async options() {
                const catalog = await loadExperts()
                return (
                  [
                    ['enterprise', catalog.experts],
                    ['personal', catalog.personalExperts],
                  ] as const
                ).flatMap(([owner, items]) =>
                  items
                    .filter(
                      item =>
                        (item.kind === 'team' || ('source' in item && item.source === 'team')) === (kind === 'team') &&
                        !(owner === 'enterprise' && 'source' in item && item.source === 'external'),
                    )
                    .map(item => ({
                      id: owner + ':' + item.id,
                      label: item.name,
                      detail: item.description,
                      group: {
                        name: owner,
                        label: t(
                          owner === 'enterprise'
                            ? kind === 'team'
                              ? 'enterpriseTeam'
                              : 'enterprise'
                            : kind === 'team'
                              ? 'personalTeam'
                              : 'personal',
                        ),
                      },
                    })),
                )
              },
              async onSelect(option, session) {
                const binding = scope.sessions.binding(session.sessionId)
                if (!binding) throw new Error(t('pickerChanged'))
                const input = scope.conversation.input.for(binding.ctx),
                  before = input.state.getSnapshot()
                const revision = before.draftRev
                if (before.phase !== 'plain') throw new Error(t('pickerChanged'))
                const split = option.id.indexOf(':'),
                  owner = option.id.slice(0, split)
                if (owner !== 'enterprise' && owner !== 'personal') throw new Error(t('failed'))
                const expert = await prepareExpert(owner, option.id.slice(split + 1))
                const prompt = expertReferenceDraft(owner, option.id.slice(split + 1), expert.name, before.draft)
                if (scope.sessions.binding(session.sessionId) !== binding || input.state.getSnapshot().draftRev !== revision)
                  throw new Error(t('pickerChanged'))
                const result = scope.conversation.input.requestDraftInitialization(binding, {
                  clearPreviousDraft: true,
                  prompt: {
                    text: prompt.text,
                    references: [
                      ...prompt.references,
                      ...before.occurrences.map(({ occurrenceId: _id, ...reference }) => reference),
                    ],
                  },
                })
                if (result !== 'applied') throw new Error(t('pickerChanged'))
                input.focus()
              },
            },
          }),
        'lfclaw: ' + kind + ' picker',
      )
  })
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({
          notify,
          manageExpert: (kind: 'expert' | 'team', expert?: { id: string; name: string }) => {
            ctx.uiWorkspace.startSession(undefined, { prompt: expertManagerDraft(kind, t, expert), reuseBlank: false })
          },
          startChat: async (owner: 'enterprise' | 'personal', id: string, task: string) => {
            const expert = await prepareExpert(owner, id)
            const prompt = expertReferenceDraft(owner, id, expert.name, task)
            ctx.uiWorkspace.startSession(undefined, { prompt, reuseBlank: false })
          },
        }),
      },
      ExpertsPage,
    ),
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 50,
        label: () => t('panel'),
        locale: NS,
      },
      ExpertsIcon,
    ),
  )
}
