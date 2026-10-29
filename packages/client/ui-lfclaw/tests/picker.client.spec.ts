// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
afterEach(() => vi.unstubAllGlobals())

it('offers lightweight experts and teams and inserts selections locally before resolving authorized instructions on send', async () => {
  const runtime = await SlotTestRuntime.create()
  const register = vi.fn().mockReturnValue(() => {}),
    registerSource = vi.fn().mockReturnValue(() => {})
  const sessionId = await runtime.sessions.add({ id: 's1', session: {} })
  const reference = runtime.sessions.retain(sessionId)
  await reference.ready
  const binding = runtime.sessions.binding('s1')!,
    state = { draft: '安排明日工作', draftRev: 4, phase: 'plain', occurrences: [] as { source: string; ref: string; label: string; clipboardText: string; offset: number; length: number; occurrenceId: string }[] }
  const initialize = vi.fn().mockReturnValue('applied'),
    focus = vi.fn(),
    startSession = vi.fn()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  runtime.ctx.provide('layout', { selectPanel: vi.fn() })
  runtime.ctx.provide('uiWorkspace', { startSession })
  runtime.ctx.provide('commandUi', { register })
  runtime.ctx.provide('inputTriggers', { registerSource })
  runtime.ctx.provide('conversation', {
    input: { for: () => ({ state: { getSnapshot: () => state }, focus }), requestDraftInitialization: initialize },
  })
  const catalog = {
    experts: [
      { id: 'e1', name: '企业顾问', kind: 'expert' },
      { id: 'remote', name: '外部', source: 'bailian' },
      { id: 'dify', name: 'Dify 顾问', source: 'dify' },
      { id: 'weknora', name: 'WeKnora 顾问', source: 'weknora' },
      { id: 'unsupported', name: '未接入', source: 'external' },
      { id: 'et1', name: '企业协作团', kind: 'team' },
    ],
    personalExperts: [
      { id: 'p1', name: '规划顾问', description: '规划', kind: 'expert' },
      { id: 't1', name: '任务团', kind: 'team' },
    ],
  }
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockResolvedValueOnce(Response.json(catalog))

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url.startsWith('/api/lfclaw/sharing-') ? Promise.resolve(Response.json({ notifications: [], shares: [] })) : fetch(url, init),
  )
  try {
    await runtime.mount({ inject: [...inject], apply })
    const expert = register.mock.calls.find(call => call[0].name === 'expert')![0]
    const team = register.mock.calls.find(call => call[0].name === 'team')![0]
    const signal = new AbortController().signal
    const options = await expert.ui.options({}, signal)
    const teamOptions = await team.ui.options({}, signal)
    expect([options, teamOptions]).toMatchSnapshot('grouped expert and team picker options')
    expect(options.map((option: { id: string }) => option.id)).toEqual([
      'enterprise:e1',
      'enterprise:remote',
      'enterprise:dify',
      'enterprise:weknora',
      'personal:p1',
    ])
    expect(teamOptions.map((option: { id: string }) => option.id)).toEqual(['enterprise:et1', 'personal:t1'])
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/lfclaw/expert-center?view=picker', { method: 'GET', signal })
    expect(fetch).toHaveBeenCalledTimes(2)
    await expert.ui.onSelect(options[4], { sessionId: 's1' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(initialize).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({
        clearPreviousDraft: true,
        prompt: expect.objectContaining({ text: expect.stringContaining('规划顾问') }),
      }),
    )
    expect(initialize.mock.calls[0]![1].prompt.text).toContain('安排明日工作')
    expect(initialize.mock.calls[0]![1].prompt.text).toBe('安排明日工作\n@规划顾问')
    expect(initialize.mock.calls[0]![1].prompt.references[0].source).toBe('lfclaw-expert')
    const codec = registerSource.mock.calls[0]![0].codec
    fetch.mockResolvedValueOnce(
      Response.json({ name: '规划顾问', instructions: '完整工作方法', members: [], skills: [], connectors: [] }),
    )
    const serialized = await codec.serialize(initialize.mock.calls[0]![1].prompt.references[0].ref, new AbortController().signal)
    expect(serialized).toContain('完整工作方法')
    expect(serialized).toContain('规划顾问')
    fetch
      .mockResolvedValueOnce(
        Response.json({
          name: '规划顾问',
          instructions: '工作方法',
          members: [],
          skills: [{ id: 's1', name: '分析技能' }],
          connectors: [],
        }),
      )
      .mockResolvedValueOnce(Response.json({ enterprise: [{ id: 's1', ready: true, invocationName: 'enterprise-analysis' }] }))
    const withSkill = await codec.serialize(initialize.mock.calls[0]![1].prompt.references[0].ref, new AbortController().signal)
    expect(withSkill.startsWith('/enterprise-analysis\n<lfclaw-expert>')).toBe(true)
    expect([serialized, withSkill]).toMatchSnapshot('logged expert references and dependency invocations')
    fetch.mockResolvedValueOnce(Response.json({ message: '专家授权已撤回' }, { status: 403 }))
    await expect(
      codec.serialize(initialize.mock.calls[0]![1].prompt.references[0].ref, new AbortController().signal),
    ).rejects.toThrow('专家授权已撤回')
    expect(startSession).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledOnce()
    state.phase = 'submitting'
    expect(() => expert.ui.onSelect(options[3], { sessionId: 's1' })).toThrow()
    expect(initialize).toHaveBeenCalledTimes(1)
    state.phase = 'plain'
    state.draft = '/report 安排明日工作'
    state.occurrences = [{ source: 'skill', ref: '/report', label: '日报', clipboardText: '/report', offset: 0, length: 7, occurrenceId: 'existing' }]
    const requestsBeforeTeam = fetch.mock.calls.length
    await team.ui.onSelect(teamOptions[1], { sessionId: 's1' })
    expect(fetch).toHaveBeenCalledTimes(requestsBeforeTeam)
    expect(initialize.mock.lastCall?.[0]).toBe(binding)
    expect(initialize.mock.lastCall?.[1].prompt.text).toBe('/report 安排明日工作\n@任务团')
    expect(initialize.mock.lastCall?.[1].prompt.references.map((reference: { offset: number }) => reference.offset))
      .toEqual([0, state.draft.length + 1])
    expect(startSession).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(2)
  } finally {
    reference.release()
    await runtime.dispose()
  }
})
