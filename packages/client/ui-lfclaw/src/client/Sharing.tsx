/** Share selection dialog and employee-addressed message list. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input, Modal, MenuItemButton, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseMenuOpenState } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './Sharing.module.css'

/** Menu-selected local conversation. */
export interface ShareTarget {
  sessionId: SessionId
  title: string
}
/** Server-owned recipient metadata; no activation codes are exposed. */
export interface ShareEmployee {
  id: string
  name: string
  department: string
}
/** Synchronized share notice. */
export interface ShareNotice {
  id: string
  shareId: string
  title: string
  senderName: string
  createdAt: number
  expiresAt: number
  read: boolean
  expired: boolean
}
/** Enterprise announcement with employee-specific read state. */
export interface AnnouncementNotice {
  id: string
  title: string
  content: string
  sentAt: string
  read: boolean
}
/** Renderer's validated inbox data. */
export interface SharingInbox {
  notices: ShareNotice[]
  announcements: AnnouncementNotice[]
  failed: boolean
  loading: boolean
}
type T = TranslateNS<'sharing'>
/** Existing Session menu contribution. @param props - Session and dialog opener. @returns Menu action. */
export function ShareMenu(
  props: PropsRuntime<'sidebar.workspaces.session.menu.item'> & {
    t: T
    useMenuOpenState: UseMenuOpenState
    requestShare: (target: ShareTarget) => void
  },
): ReactNode {
  const [, setOpen] = props.useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconUsersOutlineRegular size={14} />}
      onSelect={() => {
        setOpen(false)
        props.requestShare({ sessionId: props.sessionId, title: props.displayTitle })
      }}
    >
      {props.t('share')}
    </MenuItemButton>
  )
}
/** Modal with all-employee search and multiple recipient selection.
 * @param props - Session, limits and Host operations.
 * @returns Share dialog that keeps selection on failure.
 */
export function ShareDialog({
  target,
  t,
  close,
  send,
  employees,
  policy,
  notify,
}: {
  target: ShareTarget
  t: T
  close: () => void
  send: (target: ShareTarget, recipients: string[]) => Promise<void>
  employees: () => Promise<ShareEmployee[]>
  policy: () => Promise<{ maxBytes: number; retentionDays: number }>
  notify: (message: string) => void
}): ReactNode {
  const [list, setList] = useState<ShareEmployee[]>([]),
    [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [limits, setLimits] = useState<{ maxBytes: number; retentionDays: number } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void Promise.all([employees(), policy()])
      .then(([items, value]) => {
        if (active) {
          setList(items)
          setLimits(value)
          setError('')
        }
      })
      .catch(() => {
        if (active) setError(t('failed'))
      })
    return () => {
      active = false
    }
  }, [employees, policy, retry, t])
  const filtered = list.filter(e => `${e.name} ${e.department}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) close()
      }}
      closeLabel={t('close')}
      title={t('shareTitle', { title: target.title })}
      description={t('hint')}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !limits || !selected.length}
            onClick={() => {
              setBusy(true)
              setError('')
              void send(target, selected)
                .then(() => {
                  notify(t('sent'))
                  close()
                })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : t('failed'))
                  setBusy(false)
                })
            }}
          >
            {t(busy ? 'busy' : 'send')}
          </Button>
        </>
      }
    >
      <div className={css.dialog}>
        {limits && <p>{t('limits', { size: limits.maxBytes / 1024 / 1024, days: limits.retentionDays })}</p>}
        <Input
          aria-label={t('search')}
          placeholder={t('search')}
          value={query}
          disabled={busy}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
        <p>{t('selected', { count: selected.length })}</p>
        <div className={css.employees}>
          {!limits && !error && <div className={css.skeleton} aria-hidden />}
          {filtered.map(employee => (
            <div className={css.employee} key={employee.id}>
              <Checkbox
                disabled={busy}
                checked={selected.includes(employee.id)}
                label={employee.name}
                onChange={(checked) => {
                  setSelected(ids => (checked ? [...ids, employee.id] : ids.filter(id => id !== employee.id)))
                }}
              />
              <small>{employee.department}</small>
            </div>
          ))}
          {limits && !filtered.length && <p>{t('emptyEmployees')}</p>}
        </div>
        {error && (
          <div role="alert">
            <p>{error}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRetry(value => value + 1)
              }}
            >
              {t('refresh')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
/** Persistent inbox panel with employee read state, share claiming, and confirmed share-notice deletion.
 * @param props - Synchronized state and explicitly authenticated actions.
 * @returns Received shares and message controls.
 */
export function SharingPage({
  t,
  inbox,
  refresh,
  action,
  claim,
  notify,
}: {
  t: T
  inbox: SharingInbox
  refresh: () => Promise<void>
  action: (kind: 'share' | 'announcement', id: string, action: 'read' | 'delete') => Promise<void>
  claim: (id: string) => Promise<void>
  notify: (message: string) => void
}): ReactNode {
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState<'announcement' | 'share'>('announcement')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null),
    busyRef = useRef(false)
  const count = tab === 'announcement' ? inbox.announcements.length : inbox.notices.length
  const pageCount = Math.max(1, Math.ceil(count / 10))
  const currentPage = Math.min(pageIndex, pageCount - 1)
  useEffect(() => {
    setPageIndex(currentPage)
  }, [currentPage])
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [currentPage, tab])
  const unread =
    tab === 'announcement' ? inbox.announcements.filter(n => !n.read).length : inbox.notices.filter(n => !n.read).length
  const run = (operation: () => Promise<void>, onSuccess?: () => void) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    void operation()
      .then(() => {
        onSuccess?.()
      })
      .catch((error: unknown) => {
        notify(error instanceof Error ? error.message : t('failed'))
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }
  return (
    <section className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('inboxTitle')}</h1>
          <p>{t('inboxHint')}</p>
        </div>
        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              run(refresh)
            }}
          >
            {t('refresh')}
          </Button>
        </div>
      </header>
      <nav className={css.tabs} role="tablist" aria-label={t('inboxTitle')}>
        {(['announcement', 'share'] as const).map(value => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`lfclaw-${value}-tab`}
            aria-controls="lfclaw-inbox-panel"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value)
              setPageIndex(0)
            }}
          >
            {t(value === 'announcement' ? 'announcementTab' : 'shareTab')}
          </button>
        ))}
      </nav>
      <div className={css.scrollBody} ref={listRef} id="lfclaw-inbox-panel" role="tabpanel" aria-labelledby={`lfclaw-${tab}-tab`}>
        <p className={css.summary}>{t('unreadCount', { count: unread })}</p>
        {inbox.failed && <p role="alert">{t('failed')}</p>}
        {!inbox.loading && !inbox.failed && !count && <p>{t(tab === 'announcement' ? 'emptyAnnouncements' : 'emptyShares')}</p>}
        <div className={css.list}>
          {tab === 'announcement' &&
            inbox.announcements.slice(currentPage * 10, (currentPage + 1) * 10).map(notice => (
              <article className={`${css.card} ${notice.read ? '' : css.unreadCard}`} key={`announcement-${notice.id}`}>
                <div className={css.cardHeading}>
                  <h2>{notice.title}</h2>
                  <span className={`${css.readStatus} ${notice.read ? css.readStatusSeen : css.readStatusNew}`}>
                    {t(notice.read ? 'readStatus' : 'unreadStatus')}
                  </span>
                </div>
                <p>{t('announcementTime', { time: new Date(notice.sentAt).toLocaleString() })}</p>
                <p className={css.announcementContent}>{notice.content}</p>
                <div className={css.actions}>
                  {!notice.read && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        run(() => action('announcement', notice.id, 'read'))
                      }}
                    >
                      {t('read')}
                    </Button>
                  )}
                </div>
              </article>
            ))}
          {tab === 'share' &&
            inbox.notices.slice(currentPage * 10, (currentPage + 1) * 10).map(notice => (
              <article className={`${css.card} ${notice.read ? '' : css.unreadCard}`} key={`share-${notice.id}`}>
                <div className={css.cardHeading}>
                  <h2>{notice.title}</h2>
                  <span className={`${css.readStatus} ${notice.read ? css.readStatusSeen : css.readStatusNew}`}>
                    {t(notice.read ? 'readStatus' : 'unreadStatus')}
                  </span>
                </div>
                <p>{t('from', { name: notice.senderName })}</p>
                <p>{t('received', { time: new Date(notice.createdAt).toLocaleString() })}</p>
                <p>{notice.expired ? t('expired') : t('expires', { time: new Date(notice.expiresAt).toLocaleString() })}</p>
                <div className={css.actions}>
                  <Button
                    variant="primary"
                    disabled={busy || notice.expired}
                    onClick={() => {
                      run(() => claim(notice.shareId))
                    }}
                  >
                    {t('claim')}
                  </Button>
                  {!notice.read && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        run(() => action('share', notice.id, 'read'))
                      }}
                    >
                      {t('read')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setDeleteTarget({ id: notice.id, title: notice.title })
                    }}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </article>
            ))}
          {inbox.loading && <div className={css.skeleton} aria-hidden />}
        </div>
      </div>
      {pageCount > 1 && (
        <nav className={css.pager} aria-label={t('pagination')}>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => {
              setPageIndex(currentPage - 1)
            }}
          >
            {t('previousPage')}
          </Button>
          <span>{t('pageNumber', { current: currentPage + 1, total: pageCount })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => {
              setPageIndex(currentPage + 1)
            }}
          >
            {t('nextPage')}
          </Button>
        </nav>
      )}
      {deleteTarget && (
        <Modal
          open
          title={t('deleteShareTitle')}
          description={t('deleteShareDescription', { title: deleteTarget.title })}
          closeLabel={t('close')}
          onClose={() => {
            if (!busyRef.current) setDeleteTarget(null)
          }}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                data-modal-autofocus
                onClick={() => {
                  setDeleteTarget(null)
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  run(
                    () => action('share', deleteTarget.id, 'delete'),
                    () => {
                      setDeleteTarget(null)
                    },
                  )
                }}
              >
                {t('confirmDelete')}
              </Button>
            </>
          }
        />
      )}
    </section>
  )
}
