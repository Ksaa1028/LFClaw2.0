/** Searchable cross-session directory of declared final files. */
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  FileTypeIcon,
  IconFolderOpenOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Modal,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { basename } from '../presented.ts'
import { isPresentedHost, PRESENT_HOST_ROUTE } from '../presented.ts'
import type { CatalogFile, CatalogPage } from '../catalog.ts'
import { PRESENT_CATALOG_ROUTE } from '../catalog-route.ts'
import type { NS } from './locales.ts'
import css from './CatalogPage.module.css'

const PAGE_SIZE = 10

/** Navigation and native file action supplied by the owning plugin. */
export interface CatalogInjected {
  openPreview: (file: CatalogFile) => Promise<boolean>
  openSession: (sessionId: SessionId) => void
  openNative: (file: CatalogFile) => Promise<boolean>
}

function parsePage(value: unknown): CatalogPage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid catalog response')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.files) || !Number.isSafeInteger(record.total) || !Number.isSafeInteger(record.unreadableSessions))
    throw new Error('Invalid catalog response')
  const files: CatalogFile[] = record.files.map((value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid catalog file')
    const file = value as Record<string, unknown>
    if (
      typeof file.sessionId !== 'string' ||
      typeof file.path !== 'string' ||
      !Number.isSafeInteger(file.seq) ||
      !Number.isSafeInteger(file.index) ||
      !Number.isSafeInteger(file.time) ||
      !['available', 'missing', 'error'].includes(String(file.availability)) ||
      (file.cwd !== undefined && typeof file.cwd !== 'string') ||
      (file.description !== undefined && typeof file.description !== 'string')
    )
      throw new Error('Invalid catalog file')
    return {
      sessionId: file.sessionId as SessionId,
      path: file.path,
      seq: file.seq as number,
      index: file.index as number,
      time: file.time as number,
      availability: file.availability as CatalogFile['availability'],
      ...(typeof file.cwd === 'string' ? { cwd: file.cwd } : {}),
      ...(typeof file.description === 'string' ? { description: file.description } : {}),
    }
  })
  return { files, total: record.total as number, unreadableSessions: record.unreadableSessions as number }
}

/** Render final files across Sessions, with source and live-file actions. */
export function CatalogPage({
  t,
  useSessions,
  openPreview,
  openSession,
  openNative,
}: PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<CatalogInjected>) {
  const sessions = useSessions(state => state.byId)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [page, setPage] = useState<CatalogPage>({ files: [], total: 0, unreadableSessions: 0 })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [actionError, setActionError] = useState<string | null>(null)
  const [desktopAvailable, setDesktopAvailable] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CatalogFile | null>(null)
  const [removing, setRemoving] = useState(false)
  const [deleteError, setDeleteError] = useState<
    'catalog.restartRequired' | 'catalog.recordChanged' | 'catalog.removeError' | null
  >(null)
  const [removedNotice, setRemovedNotice] = useState(0)
  const removingRef = useRef(false)
  const sentRefresh = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [pageIndex, query])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(PRESENT_HOST_ROUTE, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const value: unknown = await response.json()
        if (!controller.signal.aborted && isPresentedHost(value)) setDesktopAvailable(value.available)
      })
      .catch(() => {
        if (!controller.signal.aborted) setDesktopAvailable(false)
      })
    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setPageIndex(0)
      setQuery(search.trim())
    }, 250)
    return () => {
      clearTimeout(timer)
    }
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    const params = new URLSearchParams({ q: query, offset: String(pageIndex * PAGE_SIZE), limit: String(PAGE_SIZE) })
    if (revision !== sentRefresh.current) {
      params.set('refresh', '1')
      sentRefresh.current = revision
    }
    void fetch(`${PRESENT_CATALOG_ROUTE}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`)
        return parsePage(await response.json())
      })
      .then((result) => {
        if (controller.signal.aborted) return
        if (pageIndex > 0 && pageIndex * PAGE_SIZE >= result.total) {
          setPageIndex(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1))
          return
        }
        setPage(result)
        setStatus('ready')
        setActionError(null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    return () => {
      controller.abort()
    }
  }, [query, revision, pageIndex])

  return (
    <section className={css.page} data-present-catalog>
      <div className={css.content}>
        <header className={css.header}>
          <div>
            <h1>{t('catalog.title')}</h1>
            <p>{t('catalog.subtitle')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            icon={<IconRefreshOutlineRegular size={16} />}
            onClick={() => {
              setPageIndex(0)
              setRevision(value => value + 1)
            }}
          >
            {t('catalog.refresh')}
          </Button>
        </header>
        <Input
          type="search"
          className={css.search ?? ''}
          icon={<IconSearchOutlineRegular size={16} />}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
          placeholder={t('catalog.search')}
          aria-label={t('catalog.search')}
        />
        <div className={css.scrollBody} ref={listRef}>
          {status === 'loading' && (
            <div className={css.feedback} role="status">
              {t('catalog.loading')}
            </div>
          )}
          {status === 'error' && (
            <div className={css.feedback} role="alert">
              {t('catalog.error')}
              <Button
                size="sm"
                onClick={() => {
                  setPageIndex(0)
                  setRevision(value => value + 1)
                }}
              >
                {t('presented.retry')}
              </Button>
            </div>
          )}
          {status === 'ready' && (
            <>
              {page.unreadableSessions > 0 && (
                <p className={css.notice} role="status">
                  {t('catalog.partial', { count: page.unreadableSessions })}
                </p>
              )}
              {actionError !== null && (
                <p className={css.notice} role="alert">
                  {actionError}
                </p>
              )}
              {page.files.length === 0 && <div className={css.feedback}>{t(query ? 'catalog.noMatches' : 'catalog.empty')}</div>}
              <ul className={css.list} aria-label={t('catalog.title')}>
                {page.files.map(file => (
                  <li key={`${file.sessionId}:${file.seq}:${file.index}`} className={css.row}>
                    <span className={css.icon}>
                      <FileTypeIcon path={file.path} size={23} />
                    </span>
                    <div className={css.details}>
                      <strong title={file.path}>{basename(file.path)}</strong>
                      <span className={css.description}>{file.description || file.path}</span>
                      <span className={css.meta}>
                        <button
                          type="button"
                          className={css.sessionLink}
                          data-source-session
                          onClick={() => {
                            openSession(file.sessionId)
                          }}
                        >
                          {sessions[file.sessionId]?.title ?? t('catalog.untitled')}
                        </button>{' '}
                        · {new Date(file.time).toLocaleString(t('catalog.locale'))} · {file.cwd ?? t('catalog.noWorkspace')}
                      </span>
                      {file.availability !== 'available' && (
                        <span className={css.missing}>
                          {t(file.availability === 'missing' ? 'catalog.missing' : 'catalog.checkFailed')}
                        </span>
                      )}
                    </div>
                    <div className={css.actions}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={file.availability !== 'available'}
                        onClick={() => {
                          void openPreview(file).then((ok) => {
                            if (!ok) setActionError(t('catalog.openError'))
                          })
                        }}
                      >
                        {t('catalog.preview')}
                      </Button>
                      {desktopAvailable && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={file.availability !== 'available'}
                          icon={<IconFolderOpenOutlineRegular size={15} />}
                          onClick={() => {
                            void openNative(file).then((ok) => {
                              if (!ok) setActionError(t('catalog.openError'))
                            })
                          }}
                        >
                          {t('catalog.open')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<IconTrashOutlineRegular size={15} />}
                        onClick={() => {
                          setDeleteError(null)
                          setDeleteTarget(file)
                        }}
                      >
                        {t('catalog.remove')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {status === 'ready' && page.total > PAGE_SIZE && (
          <nav className={css.pager} aria-label={t('catalog.pagination')}>
            <Button
              size="sm"
              variant="outline"
              disabled={pageIndex === 0}
              onClick={() => {
                setPageIndex(value => value - 1)
              }}
            >
              {t('catalog.previous')}
            </Button>
            <span>{t('catalog.page', { current: pageIndex + 1, total: Math.ceil(page.total / PAGE_SIZE) })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={(pageIndex + 1) * PAGE_SIZE >= page.total}
              onClick={() => {
                setPageIndex(value => value + 1)
              }}
            >
              {t('catalog.next')}
            </Button>
          </nav>
        )}
      </div>
      {deleteTarget && (
        <Modal
          open
          title={t('catalog.removeTitle')}
          description={t('catalog.removeDescription', { name: basename(deleteTarget.path) })}
          closeLabel={t('catalog.close')}
          onClose={() => {
            if (!removingRef.current) setDeleteTarget(null)
          }}
          footer={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={removing}
                data-modal-autofocus
                onClick={() => {
                  setDeleteTarget(null)
                }}
              >
                {t('catalog.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={removing}
                onClick={() => {
                  if (removingRef.current) return
                  removingRef.current = true
                  setRemoving(true)
                  setDeleteError(null)
                  void fetch(PRESENT_CATALOG_ROUTE, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ sessionId: deleteTarget.sessionId, seq: deleteTarget.seq, index: deleteTarget.index }),
                  })
                    .then((response) => {
                      if (!response.ok) {
                        setDeleteError(
                          response.status === 404
                            ? 'catalog.restartRequired'
                            : response.status === 409
                              ? 'catalog.recordChanged'
                              : 'catalog.removeError',
                        )
                        return false
                      }
                      return true
                    })
                    .then((removed) => {
                      if (removed) {
                        setDeleteTarget(null)
                        setRevision(value => value + 1)
                        setRemovedNotice(value => value + 1)
                      }
                    })
                    .catch(() => {
                      setDeleteError('catalog.removeError')
                    })
                    .finally(() => {
                      removingRef.current = false
                      setRemoving(false)
                    })
                }}
              >
                {t(removing ? 'catalog.removing' : 'catalog.confirmRemove')}
              </Button>
            </>
          }
        >
          {deleteError && <p role="alert">{t(deleteError)}</p>}
        </Modal>
      )}
      {removedNotice > 0 && (
        <Toast
          key={removedNotice}
          tone="success"
          text={t('catalog.removed')}
          onDone={() => {
            setRemovedNotice(0)
          }}
        />
      )}
    </section>
  )
}
