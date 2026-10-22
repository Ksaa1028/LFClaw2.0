// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ContextMeter, type ContextMeterProps } from '../../ui-conversation/src/client/skeleton/ContextMeter.tsx'
import { zh } from '../../ui-conversation/src/client/locales.ts'
import { ContextCapacity } from '../src/client/ContextCapacity.tsx'
import type { ModelDirectoryState } from '../src/client/directory.ts'

afterEach(cleanup)

it('updates an existing session from 32K to one million and isolates a fresh session reading', () => {
  const directory = createSnapshotStore<ModelDirectoryState>({
    current: { provider: 'lfclaw', model: 'm1' },
    routable: true,
    groups: [{ id: 'lfclaw', name: '企业', models: [{ id: 'm1', name: '千问', contextWindow: 32768 }] }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
  })
  const pressure = { pressureTokens: 89500, contextWindow: 32768 }
  const useProjection: ContextMeterProps['useProjection'] = (key: string) => (key === 'contextPressure' ? pressure : undefined)
  const t = makeTranslate(zh, commonZh) as ContextMeterProps['t']
  const view = render(
    <ContextCapacity
      directory={directory}
      renderMeter={contextWindow => <ContextMeter useProjection={useProjection} contextWindow={contextWindow} t={t} />}
    />,
  )
  expect(view.getByRole('button', { name: '上下文已用 100%' })).toBeTruthy()
  act(() => {
    directory.update((state) => {
      state.groups = [{ id: 'lfclaw', name: '企业', models: [{ id: 'm1', name: '千问', contextWindow: 1000000 }] }]
    })
  })
  fireEvent.click(view.getByRole('button', { name: '上下文已用 9%' }))
  expect(view.getByRole('dialog').textContent).toContain('89.5')
  expect(pressure.contextWindow).toBe(32768)
  view.rerender(
    <ContextCapacity
      directory={directory}
      renderMeter={contextWindow => <ContextMeter useProjection={() => undefined} contextWindow={contextWindow} t={t} />}
    />,
  )
  expect(view.queryByRole('button')).toBeNull()
  act(() => {
    directory.update((state) => {
      state.routable = false
    })
  })
  expect(view.queryByRole('button')).toBeNull()
})
