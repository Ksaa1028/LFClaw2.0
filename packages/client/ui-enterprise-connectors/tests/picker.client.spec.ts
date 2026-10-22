// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => vi.unstubAllGlobals())

it('groups available enterprise and personal connectors and keeps selection behavior', async () => {
  const runtime = await SlotTestRuntime.create()
  const register = vi.fn().mockReturnValue(() => {})
  const startSession = vi.fn()
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
    const picker = register.mock.calls.find(call => call[0].name === 'connector')![0]
    const pending = picker.ui.options({}, new AbortController().signal)
    expect(fetch).toHaveBeenCalledTimes(2)
    enterpriseResponse.resolve(enterprise)
    const options = await pending
    expect(options).toMatchSnapshot()
    expect(options.map((option: { id: string }) => option.id)).toEqual(['e1', 'personal:p1'])
    picker.ui.onSelect(options[1])
    expect(startSession).toHaveBeenCalledWith(undefined, {
      prompt: { text: expect.stringContaining('我的文档'), references: [] },
      reuseBlank: false,
    })
  } finally {
    await runtime.dispose()
  }
})
