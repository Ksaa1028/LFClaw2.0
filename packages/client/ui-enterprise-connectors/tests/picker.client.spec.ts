// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionInputResolver } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => vi.unstubAllGlobals())

it('groups available enterprise and personal connectors and keeps selection behavior', async () => {
  const runtime = await SlotTestRuntime.create()
  const register = vi.fn<(command: CommandContribution) => () => void>().mockReturnValue(() => {})
  const startSession = vi.fn()
  const sessionId = await runtime.sessions.add({ id: 'picker-existing', session: {} })
  const retained = runtime.sessions.retain(sessionId)
  await retained.ready
  const binding = runtime.sessions.binding(sessionId)
  const existing = { source: 'skill', ref: '/report', label: '日报', clipboardText: '/report', offset: 0, length: 7 }
  const state = { draft: '/report 帮我汇总', phase: 'plain', occurrences: [{ ...existing, occurrenceId: 'existing' }] }
  const initialize = vi.fn<SessionInputResolver['requestDraftInitialization']>().mockReturnValue('applied')
  const focus = vi.fn()
  runtime.ctx.provide('conversation', {
    input: { for: () => ({ state: { getSnapshot: () => state }, focus }), requestDraftInitialization: initialize },
  })
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  runtime.ctx.provide('layout', { selectPanel: vi.fn() })
  runtime.ctx.provide('uiWorkspace', { startSession })
  runtime.ctx.provide('commandUi', { register })
  const enterpriseResponse = Promise.withResolvers<Response>()
  const fetch = vi
    .fn()
    .mockReturnValueOnce(enterpriseResponse.promise)
    .mockResolvedValueOnce(
      Response.json({
        connectors: [
          { id: 'p1', name: '我的文档', enabled: true, connected: true },
          { id: 'p2', name: '已停用连接', enabled: false, connected: true },
        ],
      }),
    )
  const enterprise = Response.json({
    connectors: [
      { id: 'e1', name: '企业数据', hasAvailableTools: true },
      { id: 'e2', name: '不可用企业连接', hasAvailableTools: false },
    ],
  })
  vi.stubGlobal('fetch', fetch)
  try {
    await runtime.mount({ inject: [...inject], apply })
    const picker = register.mock.calls.find(([command]) => command.name === 'connector')?.[0]
    if (!picker || picker.ui.kind !== 'popupSelect') throw new Error('Missing connector picker')
    const ui = picker.ui
    const session = { sessionId } as Parameters<typeof ui.onSelect>[1]
    const pending = ui.options(session, new AbortController().signal)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/lfclaw/connector-center?view=picker', expect.anything())
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/lfclaw/personal-connectors?view=picker', expect.anything())
    enterpriseResponse.resolve(enterprise)
    const options = await pending
    expect(options).toMatchSnapshot()
    expect(options.map((option: { id: string }) => option.id)).toEqual(['e1', 'personal:p1'])
    for (const option of options) {
      await ui.onSelect(option, session)
      expect(initialize).toHaveBeenLastCalledWith(binding, {
        clearPreviousDraft: true,
        prompt: initialize.mock.lastCall?.[1].prompt,
      })
      const prompt = initialize.mock.lastCall?.[1].prompt
      if (!prompt || typeof prompt === 'string') throw new Error('Missing structured draft')
      expect(prompt.references).toEqual([existing])
      expect(prompt.text).toContain(state.draft + '\n')
      expect(prompt.text).toContain(option.label)
    }
    expect(initialize.mock.calls.map(call => call[1].prompt)).toMatchSnapshot('connector selection preserves existing draft')
    expect(startSession).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(2)
    expect(() => ui.onSelect(options[0]!, { sessionId: 'closed' } as Parameters<typeof ui.onSelect>[1])).toThrow()
    state.phase = 'submitting'
    expect(() => ui.onSelect(options[0]!, session)).toThrow()
    expect(initialize).toHaveBeenCalledTimes(2)
    state.phase = 'plain'
    initialize.mockReturnValueOnce('blocked')
    expect(() => ui.onSelect(options[0]!, session)).toThrow()
    expect(focus).toHaveBeenCalledTimes(2)
  } finally {
    retained.release()
    await runtime.dispose()
  }
})
