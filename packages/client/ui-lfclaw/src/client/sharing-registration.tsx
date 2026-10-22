/** Sharing UI contributions and lifecycle-owned inbox polling. */
import type { Context } from '@deepseek-ai/cordis'
import { useEffect } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ShareDialog, ShareMenu, SharingPage, type ShareTarget, type ShareEmployee, type ShareNotice, type AnnouncementNotice, type SharingInbox } from './Sharing.tsx'
import { sharingZh, sharingEn, type SharingKey } from './sharing-locales.ts'
import { registerShareReceipt } from './share-receipt.tsx'
import css from './Sharing.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { sharing: SharingKey } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
async function request(operation: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/lfclaw/sharing-${operation}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const value: unknown = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(record(value) && typeof value.message === 'string' ? value.message : 'SHARING_FAILED')
  return value
}
async function employees(): Promise<ShareEmployee[]> {
  const value = await request('employees')
  if (!Array.isArray(value) || value.some(e => !record(e) || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.department !== 'string')) throw new Error('SHARING_INVALID_RESPONSE')
  return value as ShareEmployee[]
}
async function policy(): Promise<{ maxBytes: number; retentionDays: number }> {
  const value = await request('policy')
  if (!record(value) || typeof value.maxBytes !== 'number' || typeof value.retentionDays !== 'number') throw new Error('SHARING_INVALID_RESPONSE')
  return { maxBytes: value.maxBytes, retentionDays: value.retentionDays }
}

/** Install reversible sharing slots and synchronized unread polling.
 * @param ctx - UI services.
 * @param refreshIntervalMs - Deployment-configured polling interval.
 * @param notify - Application-lifetime feedback owner.
 */
export function registerSharing(ctx: Context, refreshIntervalMs: number, notify: (text: string) => void): void {
  ctx.effect(() => ctx.locale.register('sharing', { zh: sharingZh, en: sharingEn }), 'lfclaw: sharing locale')
  registerShareReceipt(ctx)
  const pending = createSnapshotStore<ShareTarget | null>(null)
  const inbox = createSnapshotStore<SharingInbox>({ notices: [], announcements: [], failed: false, loading: true })
  let active = true, generation = 0
  const refresh = async () => {
    const current = ++generation
    try {
      const [value, announcements] = await Promise.all([request('notices'), request('announcements')])
      if (!Array.isArray(value) || value.some(n => !record(n) || typeof n.id !== 'string' || typeof n.shareId !== 'string'
        || typeof n.title !== 'string' || typeof n.senderName !== 'string' || typeof n.createdAt !== 'number'
        || typeof n.expiresAt !== 'number' || typeof n.read !== 'boolean' || typeof n.expired !== 'boolean')) throw new Error('SHARING_INVALID_RESPONSE')
      if (!Array.isArray(announcements) || announcements.some(n => !record(n) || typeof n.id !== 'string'
        || typeof n.title !== 'string' || typeof n.content !== 'string' || typeof n.sentAt !== 'string'
        || !Number.isFinite(Date.parse(n.sentAt)) || typeof n.read !== 'boolean')) throw new Error('ANNOUNCEMENT_INVALID_RESPONSE')
      if (active && current === generation) inbox.set({
        notices: value as ShareNotice[], announcements: announcements as AnnouncementNotice[], failed: false, loading: false,
      })
    } catch (error) {
      if (active && current === generation) inbox.set({ ...inbox.getSnapshot(), failed: true, loading: false })
      throw error
    }
  }
  let consumers = 0, timer: ReturnType<typeof setInterval> | undefined
  const subscribePolling = () => {
    consumers++
    const poll = () => { void refresh().catch((error: unknown) => { ctx.logger.debug('Share inbox refresh failed: %s', String(error)) }) }
    if (consumers === 1) { poll(); timer = setInterval(poll, refreshIntervalMs) }
    return () => { if (--consumers === 0) { clearInterval(timer); timer = undefined } }
  }
  ctx.effect(() => () => {
    active = false; clearInterval(timer)
  }, 'lfclaw: sharing inbox refresh')
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item',
    id: 'lfclaw-share', order: 300, locale: 'sharing', inject: () => ({ requestShare: (target: ShareTarget) => { pending.set(target) } }),
  }, ShareMenu))
  type OverlayProps = PropsHooks<{ pending: typeof pending }> & PropsLocale<'sharing'>
  function SharingOverlay(props: OverlayProps) {
    const target = props.usePending(value => value)
    if (!target) return null
    return <ShareDialog key={target.sessionId} target={target} t={props.t} employees={employees} policy={policy} notify={notify}
      close={() => { pending.set(null) }} send={async (target, recipients) => { await request('send', { ...target, recipients }) }} />
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'lfclaw-share-dialog', locale: 'sharing',
    inject: () => ({ hooks: { pending } }),
  }, SharingOverlay))
  const panel = 'lfclaw-sharing' as MainPanelId
  type InboxProps = PropsHooks<{ inbox: typeof inbox }> & PropsLocale<'sharing'>
  function InboxPage(props: InboxProps) {
    useEffect(subscribePolling, [])
    const state = props.useInbox(value => value)
    return <SharingPage t={props.t} inbox={state} refresh={refresh} notify={notify}
      action={async (kind, id, action) => {
        await request(kind === 'share' ? 'notices' : 'announcements', { id, action }); await refresh()
      }}
      claim={async (id) => {
        const result = await request('claim', { id })
        if (!record(result) || typeof result.sessionId !== 'string') throw new Error(props.t('failed'))
        const notice = state.notices.find(n => n.shareId === id)
        if (notice) { await request('notices', { id: notice.id, action: 'read' }); await refresh() }
        await ctx.sessions.refresh()
        ctx.uiWorkspace.openSession(result.sessionId as SessionId)
      }} />
  }
  function InboxIcon(props: InboxProps & { size: number }) {
    useEffect(subscribePolling, [])
    const state = props.useInbox(value => value)
    const count = state.notices.filter(n => !n.read).length + state.announcements.filter(n => !n.read).length
    return <span className={css.inboxIcon}><IconUsersOutlineRegular size={props.size} />
      {count > 0 && <small className={css.badge} aria-label={props.t('unreadCount', { count })}>{count}</small>}</span>
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: 'sharing', inject: () => ({ hooks: { inbox } }) }, InboxPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 70, locale: 'sharing',
    label: () => ctx.locale.bind('sharing')('panel'), inject: () => ({ hooks: { inbox } }),
  }, InboxIcon))
}
