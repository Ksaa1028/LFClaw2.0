// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DeleteSessionDialog, DeleteSessionMenu } from '../src/client/DeleteSession.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
const id = brandString<SessionId>('test-session')
const t = makeTranslate(zh)
const unusedHook = (): never => { throw new Error('Unexpected global hook') }
const globals = { usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook,
  useSessionRetainInfo: unusedHook, useWorkspaces: unusedHook, useResource: unusedHook }
afterEach(cleanup)
it('菜单请求明确的目标会话，并先关闭三个点菜单', () => {
  const close = vi.fn(), requestDelete = vi.fn()
  render(<DeleteSessionMenu {...globals} useShortcuts={unusedHook} sessionId={id} displayTitle="测试会话" useMenuOpenState={() => [true, close]} requestDelete={requestDelete} t={t} />)
  fireEvent.click(screen.getByText('删除会话'))
  expect(close).toHaveBeenCalledWith(false)
  expect(requestDelete).toHaveBeenCalledWith({ sessionId: id, title: '测试会话' })
})
it('取消不调用删除，确认失败保留确认框并允许重试', async () => {
  const settle = vi.fn(), remove = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce(undefined)
  render(<DeleteSessionDialog {...globals} usePending={select => select({ sessionId: id, title: '测试会话' })} settle={settle} remove={remove} t={t} />)
  expect(screen.getByRole('dialog').textContent).toMatchSnapshot()
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('取消'))
  expect(settle).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('确认删除'))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe('删除未完成，请刷新列表后重试')
  expect(settle).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByText('确认删除'))
  await waitFor(() => { expect(settle).toHaveBeenCalledTimes(2) })
  expect(remove).toHaveBeenCalledWith(id)
  expect(screen.getByText('会话已删除')).toBeDefined()
})
