import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UsagePage } from '../src/pages/UsagePage.tsx'
import { AppContext, initialState } from '../src/store.ts'
import { loadUsageReport } from '../src/api.ts'

vi.mock('../src/api.ts', () => ({ loadUsageReport: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('按需加载账号和模型汇总，并将日期筛选交给服务端', async () => {
  vi.mocked(loadUsageReport).mockResolvedValue({
    employees: [{ id: 'e1', name: '员工甲', calls: 2, inputTokens: 7, outputTokens: 3, totalTokens: 10, missingTokenCalls: 0 }],
    models: [{ id: 'm1', name: '模型甲', calls: 2, inputTokens: 7, outputTokens: 3, totalTokens: 10, missingTokenCalls: 0 }],
    total: { calls: 2, inputTokens: 7, outputTokens: 3, totalTokens: 10, missingTokenCalls: 0 },
  })
  render(<AppContext.Provider value={{ state: initialState, dispatch: async () => true }}>
    <UsagePage t={key => key} />
  </AppContext.Provider>)
  await waitFor(() => expect(screen.getByText('员工甲')).toBeTruthy())
  expect(screen.getByText('模型甲')).toBeTruthy()
  expect(loadUsageReport).toHaveBeenCalledTimes(1)

  fireEvent.change(screen.getByLabelText('usage.from'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('usage.to'), { target: { value: '2026-10-21' } })
  fireEvent.click(screen.getByRole('button', { name: 'filter' }))
  await waitFor(() => expect(loadUsageReport).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-21', employeeId: '', modelId: '' }, expect.any(AbortSignal)))
})
