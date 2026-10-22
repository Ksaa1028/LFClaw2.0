// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ShareDialog, SharingPage } from '../src/client/Sharing.tsx'
import { sharingZh } from '../src/client/sharing-locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/sharing-registration.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ShareReceiptDivider } from '../src/client/share-receipt.tsx'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ShareId, ShareEmployeeId } from '../src/sharing-types.ts'

afterEach(cleanup)
const t = makeTranslate(sharingZh)
it('filters employees across departments and retains multiple selections until send completes', async () => {
  const send = vi.fn(async () => {}),
    close = vi.fn(),
    notify = vi.fn()
  render(
    <ShareDialog
      target={{ sessionId: 'source' as SessionId, title: '分析' }}
      t={t}
      close={close}
      send={send}
      notify={notify}
      employees={async () => [
        { id: 'a', name: '张三', department: '一部' },
        { id: 'b', name: '李四', department: '二部' },
      ]}
      policy={async () => ({ maxBytes: 50 * 1024 * 1024, retentionDays: 30 })}
    />,
  )
  await screen.findByText('张三')
  fireEvent.click(screen.getByRole('checkbox', { name: /张三/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '二部' } })
  expect(screen.queryByText('张三')).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: /李四/ }))
  fireEvent.click(screen.getByRole('button', { name: '发送分享' }))
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith({ sessionId: 'source', title: '分析' }, ['a', 'b'])
  })
  await waitFor(() => {
    expect(close).toHaveBeenCalledOnce()
  })
  expect(notify).toHaveBeenCalledWith('会话已分享')
})
it('shows source, times and expiry, keeps expired downloads disabled, and allows marking the notice read', async () => {
  const action = vi.fn(async () => {})
  render(
    <SharingPage
      t={t}
      inbox={{
        loading: false,
        failed: false,
        announcements: [],
        notices: [
          {
            id: 'n1',
            shareId: 's1',
            title: '月度分析',
            senderName: '张三',
            createdAt: 0,
            expiresAt: 86400000,
            read: false,
            expired: true,
          },
        ],
      }}
      refresh={async () => {}}
      action={action}
      claim={async () => {}}
      notify={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  expect(screen.getByText('来自 张三')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '领取并打开' }).disabled).toBe(true)
  expect(screen.getByText('已过期')).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除消息' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /清空/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
  await waitFor(() => {
    expect(action).toHaveBeenCalledWith('share', 'n1', 'read')
  })
})
it('asks before deleting a shared message and sends a rapid repeated confirmation only once', async () => {
  let finish: (() => void) | undefined
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  render(
    <SharingPage
      t={t}
      inbox={{
        loading: false,
        failed: false,
        announcements: [],
        notices: [
          {
            id: 'n1',
            shareId: 's1',
            title: '月度分析',
            senderName: '张三',
            createdAt: 0,
            expiresAt: 86400000,
            read: true,
            expired: false,
          },
        ],
      }}
      refresh={async () => {}}
      action={action}
      claim={async () => {}}
      notify={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  fireEvent.click(screen.getByRole('button', { name: '删除消息' }))
  const dialog = screen.getByRole('dialog', { name: '删除分享消息' })
  expect(within(dialog).getByText('删除「月度分析」这条分享消息？已领取的会话会保留。')).toBeTruthy()
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('dialog', { name: '删除分享消息' })).toBeNull()
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '删除消息' }))
  const confirm = within(screen.getByRole('dialog', { name: '删除分享消息' })).getByRole('button', { name: '确认删除' })
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  expect(action).toHaveBeenCalledOnce()
  expect(action).toHaveBeenCalledWith('share', 'n1', 'delete')
  finish?.()
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: '删除分享消息' })).toBeNull()
  })
})
it('keeps the shared message and confirmation available after deletion fails', async () => {
  const notify = vi.fn(),
    action = vi.fn(async () => {
      throw new Error('删除失败')
    })
  render(
    <SharingPage
      t={t}
      inbox={{
        loading: false,
        failed: false,
        announcements: [],
        notices: [
          {
            id: 'n1',
            shareId: 's1',
            title: '月度分析',
            senderName: '张三',
            createdAt: 0,
            expiresAt: 86400000,
            read: true,
            expired: false,
          },
        ],
      }}
      refresh={async () => {}}
      action={action}
      claim={async () => {}}
      notify={notify}
    />,
  )
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  fireEvent.click(screen.getByRole('button', { name: '删除消息' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '删除分享消息' })).getByRole('button', { name: '确认删除' }))
  await waitFor(() => {
    expect(notify).toHaveBeenCalledWith('删除失败')
  })
  expect(screen.getByRole('dialog', { name: '删除分享消息' })).toBeTruthy()
  expect(screen.getByText('月度分析')).toBeTruthy()
})
it('shows company announcements in the inbox and counts their unread state', async () => {
  const action = vi.fn(async () => {})
  render(
    <SharingPage
      t={t}
      inbox={{
        loading: false,
        failed: false,
        notices: [],
        announcements: [
          {
            id: 'a1',
            title: '维护通知',
            content: '今晚 22:00\n暂停服务',
            sentAt: '2026-10-19T08:00:00.000Z',
            read: false,
          },
        ],
      }}
      refresh={async () => {}}
      action={action}
      claim={async () => {}}
      notify={vi.fn()}
    />,
  )
  expect(screen.getByText('维护通知')).toBeTruthy()
  expect(within(screen.getByRole('article')).queryByText('企业公告')).toBeNull()
  expect(screen.getByText((_, element) => element?.textContent === '今晚 22:00\n暂停服务')).toBeTruthy()
  expect(screen.getByText('1 条未读')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
  await waitFor(() => {
    expect(action).toHaveBeenCalledWith('announcement', 'a1', 'read')
  })
})
it('distinguishes read messages and only offers marking unread messages as read', async () => {
  const action = vi.fn(async () => {})
  render(
    <SharingPage
      t={t}
      inbox={{
        loading: false,
        failed: false,
        announcements: [
          { id: 'a1', title: '新公告', content: '内容', sentAt: '2026-10-20T08:00:00Z', read: false },
          { id: 'a2', title: '旧公告', content: '内容', sentAt: '2026-10-19T08:00:00Z', read: true },
        ],
        notices: [
          {
            id: 'n1',
            shareId: 's1',
            title: '新分享',
            senderName: '张三',
            createdAt: 0,
            expiresAt: 86400000,
            read: false,
            expired: false,
          },
          {
            id: 'n2',
            shareId: 's2',
            title: '旧分享',
            senderName: '李四',
            createdAt: 0,
            expiresAt: 86400000,
            read: true,
            expired: false,
          },
        ],
      }}
      refresh={async () => {}}
      action={action}
      claim={async () => {}}
      notify={vi.fn()}
    />,
  )
  const [newAnnouncement, oldAnnouncement] = screen.getAllByRole('article')
  if (!newAnnouncement || !oldAnnouncement) throw new Error('Expected two announcements')
  expect(within(newAnnouncement).getByText('未读')).toBeTruthy()
  expect(within(newAnnouncement).getByRole('button', { name: '标为已读' })).toBeTruthy()
  expect(within(oldAnnouncement).getByText('已读')).toBeTruthy()
  expect(within(oldAnnouncement).queryByRole('button', { name: /标为/ })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  const [newShare, oldShare] = screen.getAllByRole('article')
  if (!newShare || !oldShare) throw new Error('Expected two shares')
  expect(within(newShare).getByText('未读')).toBeTruthy()
  expect(within(newShare).getByRole('button', { name: '标为已读' })).toBeTruthy()
  expect(within(oldShare).getByText('已读')).toBeTruthy()
  expect(within(oldShare).queryByRole('button', { name: /标为/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '标为未读' })).toBeNull()
  fireEvent.click(within(newShare).getByRole('button', { name: '标为已读' }))
  await waitFor(() => {
    expect(action).toHaveBeenCalledWith('share', 'n1', 'read')
  })
})
it('separates announcements and colleague shares, including unread totals and marking only the selected message', async () => {
  const action = vi.fn(async () => {})
  render(
    <SharingPage
      t={t}
      inbox={{
        loading: false,
        failed: false,
        announcements: [{ id: 'a1', title: '办公通知', content: '公告正文', sentAt: '2026-10-19T08:00:00.000Z', read: false }],
        notices: [
          {
            id: 'n1',
            shareId: 's1',
            title: '同事的会话',
            senderName: '李四',
            createdAt: 0,
            expiresAt: 86400000,
            read: false,
            expired: false,
          },
        ],
      }}
      refresh={async () => {}}
      action={action}
      claim={async () => {}}
      notify={vi.fn()}
    />,
  )
  expect(screen.getByRole('tab', { name: '企业公告' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('办公通知')).toBeTruthy()
  expect(screen.queryByText('同事的会话')).toBeNull()
  expect(screen.getByText('1 条未读')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /删除|清空/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
  await waitFor(() => {
    expect(action).toHaveBeenCalledWith('announcement', 'a1', 'read')
  })
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  expect(screen.getByRole('tab', { name: '同事分享' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByText('办公通知')).toBeNull()
  expect(screen.getByText('同事的会话')).toBeTruthy()
  expect(within(screen.getByRole('article')).getByText('来自 李四')).toBeTruthy()
  expect(screen.getByText('1 条未读')).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除消息' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /清空/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
  await waitFor(() => {
    expect(action).toHaveBeenCalledWith('share', 'n1', 'read')
  })
  expect(action).toHaveBeenCalledTimes(2)
})
it('renders the empty inbox and its message controls', () => {
  const view = render(
    <SharingPage
      t={t}
      inbox={{ loading: false, failed: false, notices: [], announcements: [] }}
      refresh={async () => {}}
      action={async () => {}}
      claim={async () => {}}
      notify={vi.fn()}
    />,
  )
  expect(screen.getByText('暂无企业公告')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  expect(screen.getByText('暂无同事分享')).toBeTruthy()
  expect(view.container).toMatchSnapshot()
})
it('keeps source attribution and the original-history divider visible without contacting the expired share server', () => {
  render(
    <ShareReceiptDivider
      t={t}
      receipt={{
        shareId: brandString<ShareId>('s1'),
        senderId: brandString<ShareEmployeeId>('sender'),
        senderName: '张三',
        sharedAt: 1,
        title: '原始聊天',
      }}
    />,
  )
  expect(screen.getByText('以上为分享的原始记录，以下内容保存在你的独立会话中')).toBeTruthy()
  expect(screen.getByText(/「原始聊天」由 张三/)).toBeTruthy()
})

it('pages each message tab by ten and clamps the page after messages disappear', () => {
  const announcements = Array.from({ length: 21 }, (_, index) => ({
    id: 'a' + index,
    title: 'Announcement ' + index,
    content: 'Body',
    sentAt: '2026-10-20T08:00:00Z',
    read: false,
  }))
  const notices = Array.from({ length: 11 }, (_, index) => ({
    id: 'n' + index,
    shareId: 's' + index,
    title: 'Share ' + index,
    senderName: 'Sender',
    createdAt: Date.parse('2026-10-20T08:00:00Z'),
    expiresAt: Date.parse('2026-10-25T08:00:00Z'),
    expired: false,
    read: false,
  }))
  const props = {
    t,
    inbox: { loading: false, failed: false, announcements, notices },
    refresh: async () => {},
    action: async () => {},
    claim: async () => {},
    notify: vi.fn(),
  }
  const view = render(<SharingPage {...props} />)
  expect(screen.getAllByRole('article')).toHaveLength(10)
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('Announcement 10')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getAllByRole('article')).toHaveLength(1)
  view.rerender(<SharingPage {...props} inbox={{ ...props.inbox, announcements: announcements.slice(0, 20) }} />)
  expect(screen.getAllByRole('article')).toHaveLength(10)
  expect(screen.getByText('第 2 / 2 页')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '同事分享' }))
  expect(screen.getByText('Share 0')).toBeTruthy()
  expect(screen.getAllByRole('article')).toHaveLength(10)
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('Share 10')).toBeTruthy()
  expect(screen.getAllByRole('article')).toHaveLength(1)
})
