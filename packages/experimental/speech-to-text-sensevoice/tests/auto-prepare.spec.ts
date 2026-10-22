/** Automatic preparation publishes failures and preserves explicit retry and disposal. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import { expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { prepareRuntime } from '../src/runtime.ts'

vi.mock('../src/runtime.ts', () => ({ prepareRuntime: vi.fn(), inspectRuntime: vi.fn() }))

it('prepares on activation, exposes failure, and permits an explicit retry', async () => {
  const ctx = new Context()
  const prepare = vi.mocked(prepareRuntime).mockRejectedValue(new Error('offline'))
  try {
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(SpeechToText, { defaultProvider: 'sensevoice-local' })
    const fiber = ctx.plugin(Provider, { dataRoot: process.cwd(), autoPrepare: true })
    await fiber
    const speech = ctx.get('speechToText')!
    const provider = () => speech.snapshot().providers[0]!
    await vi.waitFor(() => { expect(provider().preparation.phase).toBe('failed') })
    expect(prepare).toHaveBeenCalledOnce()
    await new Promise(resolve => setTimeout(resolve, 0))
    speech.prepare(provider().id)
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledTimes(2) })
    await fiber.dispose()
    expect(speech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose(); prepare.mockReset() }
})
