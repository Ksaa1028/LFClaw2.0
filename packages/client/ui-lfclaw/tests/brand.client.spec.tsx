// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

it.each([true, false])('overrides default brands and restores them on disposal (default first: %s)', async (defaultFirst) => {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  runtime.ctx.slots.installLocale(runtime.ctx.locale)
  runtime.ctx.provide('layout', { selectPanel: vi.fn() })
  runtime.ctx.provide('uiWorkspace', { startSession: vi.fn() })
  const names = ['sidebar.brand.mark', 'conversation.hero.brand.mark'] as const
  await runtime.declare({
    'sidebar.brand.mark': { kind: 'single', scope: 'root' },
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
  })
  const mountDefault = () =>
    runtime.mount({
      inject: ['slots'],
      apply(ctx) {
        for (const name of [...names, 'sidebar.brand.name'] as const)
          ctx.effect(() => ctx.slots.register({ name }, () => createElement('span', null, 'Default brand')))
      },
    })
  try {
    if (defaultFirst) await mountDefault()
    const lfclaw = await runtime.mount({ inject: [...inject], apply })
    if (!defaultFirst) await mountDefault()
    const views = names.map(name => runtime.renderSlot(name, { size: 24 }))
    const wordmark = runtime.renderSlot('sidebar.brand.name', {})
    expect(wordmark.container.textContent).toBe('LFClaw')
    for (const view of views) expect(view.container.querySelector('img')?.getAttribute('src')).toBe('./assets/lfclaw-logo.svg')
    await lfclaw.dispose()
    expect(wordmark.container.textContent).toBe('Default brand')
    for (const view of views) {
      expect(view.container.querySelector('img')).toBeNull()
      expect(view.container.textContent).toBe('Default brand')
    }
  } finally {
    await runtime.dispose()
  }
})

it('uses the LFClaw logo in both brand slots at the host-requested size', async () => {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  runtime.ctx.slots.installLocale(runtime.ctx.locale)
  runtime.ctx.provide('layout', { selectPanel: vi.fn() })
  runtime.ctx.provide('uiWorkspace', { startSession: vi.fn() })
  await runtime.declare({
    'sidebar.brand.mark': { kind: 'single', scope: 'root' },
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
  })
  try {
    await runtime.mount({ inject: [...inject], apply })
    const sidebar = runtime.renderSlot('sidebar.brand.mark', { size: 24 })
    const hero = runtime.renderSlot('conversation.hero.brand.mark', { size: 34, className: 'hero-brand' })
    const wordmark = runtime.renderSlot('sidebar.brand.name', {})
    expect(wordmark.container).toMatchSnapshot()
    expect(sidebar.container).toMatchSnapshot()
    expect(hero.container).toMatchSnapshot()
    expect(sidebar.container.querySelector('img')?.getAttribute('src')).toBe('./assets/lfclaw-logo.svg')
    expect(hero.container.querySelector('img')?.getAttribute('width')).toBe('34')
    expect(hero.container.querySelector('svg')).toBeNull()
  } finally {
    await runtime.dispose()
  }
})
