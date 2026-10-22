// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EmployeeBadge } from '../src/client/EmployeeBadge.tsx'
import type { EmployeeProfile } from '../src/client/employee.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { signOutEmployee } from '../src/client/sign-out.ts'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('已验证员工展示姓名和部门，侧栏收起仅保留头像，清除身份后不展示旧资料', () => {
  let employee: EmployeeProfile | null = { name: '王明', departmentName: '营运一层' }
  const useEmployee = <T,>(select: (value: EmployeeProfile | null) => T) => select(employee)
  const signOut = vi.fn()
  const t = makeTranslate(zh)
  const view = render(<EmployeeBadge useEmployee={useEmployee} signOut={signOut} wide t={t} />)
  expect(screen.getByText('王明')).toBeTruthy()
  expect(screen.getByText('营运一层')).toBeTruthy()
  expect(view.container.textContent).toMatchInlineSnapshot('"王王明营运一层"')
  view.rerender(<EmployeeBadge useEmployee={useEmployee} signOut={signOut} wide={false} t={t} />)
  expect(screen.queryByText('王明')).toBeNull()
  expect(screen.getByLabelText('王明 · 营运一层')).toBeTruthy()
  employee = null
  view.rerender(<EmployeeBadge useEmployee={useEmployee} signOut={signOut} wide={false} t={t} />)
  expect(view.container.textContent).toBe('')
})

it('取消不退出，失败后允许重试，确认清除凭据才重新加载', async () => {
  const reload = vi.fn()
  const transport = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ activated: false }))
  vi.stubGlobal('fetch', transport)
  render(
    <EmployeeBadge
      useEmployee={select => select({ name: '王明', departmentName: '营运一层' })}
      signOut={() => signOutEmployee(reload)}
      wide
      t={makeTranslate(zh)}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '王明 · 营运一层' }))
  expect(screen.getByRole('dialog').textContent).toMatchInlineSnapshot(
    '"退出并重新激活退出将清除本机登录状态，返回激活页，可重新输入激活码。本机聊天记录和文件会保留；正在运行的任务可能因登录失效而失败，建议先等待任务结束取消退出并重新激活"',
  )
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(transport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '王明 · 营运一层' }))
  fireEvent.click(screen.getByRole('button', { name: '退出并重新激活' }))
  await screen.findByRole('alert')
  expect(reload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '退出并重新激活' }))
  await waitFor(() => {
    expect(reload).toHaveBeenCalledOnce()
  })
  expect(transport).toHaveBeenLastCalledWith('/api/lfclaw/logout', { method: 'POST' })
})

it('退出结果不明确时不重新加载', async () => {
  const reload = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ activated: true })))
  await expect(signOutEmployee(reload)).rejects.toThrow('not confirmed')
  expect(reload).not.toHaveBeenCalled()
})
