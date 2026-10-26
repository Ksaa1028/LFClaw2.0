/** Connector center panel and desktop sidebar entry. */
import { createElement, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { StartSessionOptions } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ConnectorsPage } from './ConnectorsPage.tsx'
import { zh, en, type ConnectorCenterKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { connectorCenter: ConnectorCenterKey }
}

const PANEL = brandString<MainPanelId>('lfclaw-connectors')
/** Required client services. */
export const inject = ['slots', 'locale', 'layout', 'uiWorkspace']
function Icon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode { return createElement(IconLinkOutlineRegular, { size }) }
/** Register the connector page. @param ctx - client context. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('connectorCenter', { zh, en }), 'lfclaw: connector dictionaries')
  const t = ctx.locale.bind('connectorCenter')
  const startChat = (name: string) => {
    const prompt: NonNullable<StartSessionOptions['prompt']> = { text: t('draftPrompt', { name }), references: [] }
    ctx.uiWorkspace.startSession(undefined, { prompt, reuseBlank: false })
  }
  ctx.inject(['commandUi', 'sessions', 'conversation'], (scope) => {
    scope.effect(() => scope.commandUi.register({
      name: 'connector', label: () => t('addConnector'), description: () => t('addConnectorDescription'),
      icon: IconLinkOutlineRegular, available: () => true,
      ui: {
        kind: 'popupSelect', searchMode: 'fuzzy-label',
        searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noResults: t('noMatches') }),
        async options(_session, signal) {
          const [response, personalResponse] = await Promise.all([
            fetch('/api/lfclaw/connector-center?view=picker', { signal }),
            fetch('/api/lfclaw/personal-connectors?view=picker', { signal }).catch(() => undefined),
          ])
          signal.throwIfAborted()
          if (!response.ok) throw new Error(t('unavailable'))
          const value: unknown = await response.json()
          if (!value || typeof value !== 'object' || !('connectors' in value) || !Array.isArray(value.connectors)) throw new Error(t('unavailable'))
          const enterprise = value.connectors.flatMap((item: unknown) => {
            if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string'
              || !('name' in item) || typeof item.name !== 'string'
              || !('hasAvailableTools' in item) || item.hasAvailableTools !== true) return []
            return [{ id: item.id, label: item.name, group: { name: 'enterprise', label: t('enterprise') } }]
          })
          if (!personalResponse?.ok) return enterprise
          const personal: unknown = await personalResponse.json()
          if (!personal || typeof personal !== 'object' || !('connectors' in personal) || !Array.isArray(personal.connectors)) return enterprise
          return [...enterprise, ...personal.connectors.flatMap((item: unknown) => {
            if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string'
              || !('name' in item) || typeof item.name !== 'string' || !('enabled' in item) || !item.enabled
              || !('connected' in item) || item.connected !== true) return []
            return [{ id: `personal:${item.id}`, label: item.name, group: { name: 'personal', label: t('personal') } }]
          })]
        },
        onSelect(option, session) {
          const binding = scope.sessions.binding(session.sessionId)
          if (!binding) throw new Error(t('pickerChanged'))
          const input = scope.conversation.input.for(binding.ctx)
          const before = input.state.getSnapshot()
          if (before.phase !== 'plain') throw new Error(t('pickerChanged'))
          const selected = { text: t('draftPrompt', { name: option.label }) }
          const prefix = before.draft ? before.draft + '\n' : ''
          const result = scope.conversation.input.requestDraftInitialization(binding, {
            clearPreviousDraft: true,
            prompt: {
              text: prefix + selected.text,
              references: [
                ...before.occurrences.map(({ occurrenceId: _id, ...reference }) => reference),
              ],
            },
          })
          if (result !== 'applied') throw new Error(t('pickerChanged'))
          input.focus()
        },
      },
    }), 'lfclaw: connector picker')
  })
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: 'connectorCenter', inject: () => ({
    startChat,
  }) }, ConnectorsPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 47,
    label: () => t('title'), locale: 'connectorCenter' }, Icon))
}
