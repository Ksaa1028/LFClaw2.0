// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('loads the enterprise headline, updates the badge on focus and preserves text on failed refresh', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ headline: '让想法落地，让工作轻松', badge: '企业版', showBadge: true }))
  vi.stubGlobal('fetch', fetcher)
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  runtime.ctx.slots.installLocale(runtime.ctx.locale)
  await runtime.declare({ 'conversation.hero.brand.text': { kind: 'single', scope: 'root' } })
  try {
    await runtime.mount({ inject: [...inject], apply })
    const rendered = runtime.renderSlot('conversation.hero.brand.text', { badgeClassName: 'badge' })
    const view = { ...within(rendered.container), container: rendered.container }
    await waitFor(() => {
      expect(view.getByText('企业版')).toBeTruthy()
    })
    expect(view.container.textContent).toMatchInlineSnapshot('"让想法落地，让工作轻松企业版"')
    fetcher.mockResolvedValue(Response.json({ headline: '让工作，自然向前', badge: '企业版', showBadge: false }))
    fireEvent.focus(window)
    await waitFor(() => {
      expect(view.getByText('让工作，自然向前')).toBeTruthy()
    })
    expect(view.queryByText('企业版')).toBeNull()
    fetcher.mockResolvedValue(Response.json({ headline: '' }))
    fireEvent.focus(window)
    await waitFor(() => {
      expect(view.getByRole('button')).toBeTruthy()
    })
    expect(view.getByText('让工作，自然向前')).toBeTruthy()
    fetcher.mockResolvedValue(Response.json({ headline: '恢复后的口号', badge: '', showBadge: false }))
    fireEvent.click(view.getByRole('button'))
    await waitFor(() => {
      expect(view.getByText('恢复后的口号')).toBeTruthy()
    })
    expect(view.queryByRole('button')).toBeNull()
  } finally {
    await runtime.dispose()
  }
})
