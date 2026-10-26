// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SessionInputResolver } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '../src/client/index.ts'

it('adds enterprise and personal skills to the existing draft without creating a session', async () => {
  const runtime = await SlotTestRuntime.create()
  const register = vi.fn<(command: CommandContribution) => () => void>().mockReturnValue(() => {})
  const startSession = vi.fn(), initialize = vi.fn<SessionInputResolver['requestDraftInitialization']>().mockReturnValue('applied'), focus = vi.fn()
  const sessionId = await runtime.sessions.add({ id: 'existing', session: {} })
  const retained = runtime.sessions.retain(sessionId)
  await retained.ready
  const binding = runtime.sessions.binding(sessionId)
  const existing = { source: 'file', ref: '/report.txt', label: 'report.txt', clipboardText: '@report.txt', offset: 0, length: 11 }
  const state = { draft: '@report.txt 帮我分析', phase: 'plain', occurrences: [{ ...existing, occurrenceId: 'file1' }] }
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  runtime.ctx.provide('layout', { selectPanel: vi.fn() })
  runtime.ctx.provide('uiWorkspace', { startSession })
  runtime.ctx.provide('commandUi', { register, hideFromMenu: () => () => {} })
  runtime.ctx.provide('conversation', {
    input: { for: () => ({ state: { getSnapshot: () => state }, focus }), requestDraftInitialization: initialize },
  })
  try {
    await runtime.mount({ inject: [...inject], apply })
    const picker = register.mock.calls.find(([command]) => command.name === 'skill')?.[0].ui
    if (!picker || picker.kind !== 'popupSelect') throw new Error('Missing skill picker')
    const session = { sessionId } as Parameters<typeof picker.onSelect>[1]
    for (const id of ['enterprise-analysis', 'personal-analysis']) {
      await picker.onSelect({ id, label: '分析方法' }, session)
      expect(initialize).toHaveBeenLastCalledWith(binding, {
        clearPreviousDraft: true,
        prompt: {
          text: state.draft + '\n/' + id + ' ',
          references: [existing, { source: 'skill', ref: '/' + id, label: '分析方法', clipboardText: '/' + id, offset: state.draft.length + 1, length: id.length + 1 }],
        },
      })
    }
    expect(initialize.mock.calls.map(call => call[1].prompt)).toMatchSnapshot('skill selection preserves existing references')
    expect(startSession).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(2)
    state.phase = 'submitting'
    expect(() => picker.onSelect({ id: 'busy', label: '分析' }, session)).toThrow()
    expect(initialize).toHaveBeenCalledTimes(2)
    state.phase = 'plain'
    initialize.mockReturnValueOnce('blocked')
    expect(() => picker.onSelect({ id: 'blocked', label: '分析' }, session)).toThrow()
    expect(focus).toHaveBeenCalledTimes(2)
  } finally {
    retained.release()
    await runtime.dispose()
  }
})
