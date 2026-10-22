// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActivationPage } from '../src/client/pages/ActivationPage.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
const t = makeTranslate(zh)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('激活页先验证状态，提交成功后退出遮罩', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ activated: false }))
    .mockResolvedValueOnce(Response.json({ activated: true, employee: { name: '员工', departmentName: '营运一层' } }))
  vi.stubGlobal('fetch', transport)
  render(<ActivationPage t={t} />)
  await waitFor(() => {
    expect(screen.getByLabelText('激活码').hasAttribute('disabled')).toBe(false)
  })
  expect(screen.getByRole('dialog').textContent).toMatchInlineSnapshot(
    '"LFClaw让工作，自然向前。连接你的企业智能工作空间激活码激活并进入没有激活码？请联系企业管理员由企业统一授权 · 为你的工作而来。"',
  )
  fireEvent.change(screen.getByLabelText('激活码'), { target: { value: 'test-code' } })
  fireEvent.click(screen.getByRole('button', { name: '激活并进入' }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(transport.mock.calls[1]?.[0]).toBe('/api/lfclaw/activate')
})
