import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationsPage } from '../src/pages/NotificationsPage.tsx'
import { AppContext, initialState, appReducer } from '../src/store.ts'
import type { AppAction } from '../src/store.ts'
import type { Notification } from '../src/mock/data.ts'

vi.mock('../src/pages/SharingPolicy.tsx', () => ({ SharingPolicy: () => null }))

afterEach(() => cleanup())

const announcement: Notification = {
  id: 'n1', title: '紧急公告', content: '消息正文', sentAt: '2026-10-19T08:00:00.000Z',
}

it('历史通知经确认后提交撤回，并将公告标为已撤回', async () => {
  const dispatch = vi.fn(async (_action: AppAction) => true)
  const showToast = vi.fn()
  const { rerender } = render(<AppContext.Provider value={{ state: { ...initialState, notifications: [announcement] }, dispatch }}>
    <NotificationsPage t={key => key} showToast={showToast} />
  </AppContext.Provider>)

  fireEvent.click(screen.getByRole('button', { name: 'notifications.revokeNamed' }))
  expect(dispatch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'notifications.confirmRevoke' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'REVOKE_NOTIFICATION', payload: announcement }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('notifications.revoked', 'success'))

  const recalled = { ...announcement, revokedAt: '2026-10-19T08:05:00.000Z' }
  const state = appReducer({ ...initialState, notifications: [announcement] }, { type: 'REVOKE_NOTIFICATION', payload: recalled })
  rerender(<AppContext.Provider value={{ state, dispatch }}>
    <NotificationsPage t={key => key} showToast={showToast} />
  </AppContext.Provider>)
  expect(screen.queryByRole('button', { name: 'notifications.revokeNamed' })).toBeNull()
  expect(screen.getByText('notifications.revoked')).toBeTruthy()
  expect(screen.getByText('notifications.revokedAt')).toBeTruthy()
})

it('仅已撤回公告可确认删除，成功后历史列表移除该项', async () => {
  const dispatch = vi.fn(async (_action: AppAction) => true)
  const showToast = vi.fn()
  const recalled = { ...announcement, revokedAt: '2026-10-19T08:05:00.000Z' }
  const active = { ...announcement, id: 'n2', title: '尚未撤回' }
  const { rerender } = render(<AppContext.Provider value={{ state: { ...initialState, notifications: [active, recalled] }, dispatch }}>
    <NotificationsPage t={key => key} showToast={showToast} />
  </AppContext.Provider>)
  expect(screen.getAllByRole('button', { name: 'notifications.deleteNamed' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'notifications.deleteNamed' }))
  expect(dispatch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'notifications.confirmDelete' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_NOTIFICATION', payload: recalled.id }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('notifications.deleted', 'success'))

  const state = appReducer({ ...initialState, notifications: [active, recalled] }, { type: 'DELETE_NOTIFICATION', payload: recalled.id })
  rerender(<AppContext.Provider value={{ state, dispatch }}>
    <NotificationsPage t={key => key} showToast={showToast} />
  </AppContext.Provider>)
  expect(screen.queryByText(announcement.title)).toBeNull()
  expect(screen.getByText(active.title)).toBeTruthy()
})
