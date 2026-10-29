/** 企业授权目录与当前员工的个人技能。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal, IconSkillOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StartSessionOptions } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillCenterKey } from './locales.ts'
import css from './SkillsPage.module.css'
import { skillDraft } from './skill-draft.ts'

interface Item {
  name: string
  description: string
  version?: string
  invocationName?: string
  icon?: string
  id?: string
  enabled: boolean
  userInvocable: boolean
  loading: boolean
  error: boolean
}
interface Catalog {
  displayPending: boolean
  enterprise: Item[]
  personal: Item[]
  maxArchiveBytes: number
  refreshIntervalMs: number
}
function parseCatalog(value: unknown): Catalog {
  if (
    !value ||
    typeof value !== 'object' ||
    !('enterprise' in value) ||
    !Array.isArray(value.enterprise) ||
    !('personal' in value) ||
    !Array.isArray(value.personal) ||
    !('maxArchiveBytes' in value) ||
    typeof value.maxArchiveBytes !== 'number' ||
    !('refreshIntervalMs' in value) ||
    typeof value.refreshIntervalMs !== 'number' ||
    value.refreshIntervalMs < 1000
  )
    throw new Error('unavailable')
  const items = (input: unknown[]): Item[] =>
    input.map((item: unknown) => {
      if (
        !item ||
        typeof item !== 'object' ||
        !('name' in item) ||
        typeof item.name !== 'string' ||
        !('description' in item) ||
        typeof item.description !== 'string'
      )
        throw new Error('unavailable')
      return {
        name: item.name,
        description: item.description,
        enabled: !('enabled' in item) || item.enabled !== false,
        userInvocable: !('userInvocable' in item) || item.userInvocable !== false,
        loading: 'loading' in item && item.loading === true,
        error: 'error' in item && item.error === true,
        ...('id' in item && typeof item.id === 'string' ? { id: item.id } : {}),
        ...('version' in item && typeof item.version === 'string' ? { version: item.version } : {}),
        ...('icon' in item && typeof item.icon === 'string' ? { icon: item.icon } : {}),
        ...('invocationName' in item && typeof item.invocationName === 'string' ? { invocationName: item.invocationName } : {}),
      }
    })
  return {
    displayPending: 'displayPending' in value && value.displayPending === true,
    enterprise: items(value.enterprise),
    personal: items(value.personal),
    maxArchiveBytes: value.maxArchiveBytes,
    refreshIntervalMs: value.refreshIntervalMs,
  }
}
/** 页面所需文案和会话导航。 */
export interface SkillsPageProps {
  t: TranslateNS<'skillCenter'>
  startChat: (prompt: NonNullable<StartSessionOptions['prompt']>) => void
}
function SkillIcon({ icon }: { icon: string | undefined }): ReactNode {
  const [failed, setFailed] = useState<string | null>(null)
  const uploaded = icon && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(icon) && failed !== icon
  return (
    <span className={css.skillIcon}>
      {uploaded ? (
        <img
          src={icon}
          alt=""
          onError={() => {
            setFailed(icon)
          }}
        />
      ) : (
        <IconSkillOutlineRegular size={22} />
      )}
    </span>
  )
}
/** 渲染技能目录和导入操作。 @param props - 文案与导航。 @returns 技能页面。 */
export function SkillsPage({ t, startChat }: SkillsPageProps): ReactNode {
  const [tab, setTab] = useState<'enterprise' | 'personal'>('enterprise')
  const [data, setData] = useState<Catalog | null>(null)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<Item | null>(null)
  const [replacement, setReplacement] = useState<{ file: File; revision: string } | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeFailed, setRemoveFailed] = useState(false)
  const [error, setError] = useState<SkillCenterKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (wait = false): Promise<void> => {
      try {
        const params = new URLSearchParams()
        if (wait) {
          params.set('wait', '1')
          params.set('display', '1')
        } else params.set('summary', '1')
        if (attempt) params.set('refresh', '1')
        const response = await fetch(`/api/lfclaw/skill-center${params.size ? `?${params}` : ''}`, { signal: controller.signal })
        if (!response.ok) throw new Error('unavailable')
        const result = parseCatalog(await response.json())
        if (controller.signal.aborted) return
        setData(result)
        setError(null)
        if (!wait && (result.displayPending || result.enterprise.some(item => item.loading))) {
          await load(true)
          return
        }
        timer = setTimeout(() => {
          void load()
        }, result.refreshIntervalMs)
      } catch (_error) {
        if (!controller.signal.aborted) {
          setError('unavailable')
          if (data)
            timer = setTimeout(() => {
              void load()
            }, data.refreshIntervalMs)
        }
      }
    }
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setAttempt(value => value + 1)
    }
    window.addEventListener('lfclaw-skills-changed', refresh)
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener('lfclaw-skills-changed', refresh)
    }
  }, [attempt])
  useEffect(() => {
    if (!data) return
    setDetail(prior => (prior ? (data[tab].find(item => (item.id ?? item.name) === (prior.id ?? prior.name)) ?? null) : null))
  }, [data, tab])
  const items = (data?.[tab] ?? []).filter(item =>
    `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim()),
  )
  return (
    <section className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setAttempt(value => value + 1)
            }}
          >
            {t('refresh')}
          </Button>
          {tab === 'personal' && (
            <>
              <Button variant="outline" disabled={!data || busy} onClick={() => file.current?.click()}>
                {t(busy ? 'busy' : 'import')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  startChat(t('creationPrompt'))
                }}
              >
                {t('create')}
              </Button>
            </>
          )}
        </div>
      </header>
      <div className={css.tabs} role="tablist">
        {(['enterprise', 'personal'] as const).map(key => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key)
              setSearch('')
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <div className={css.toolbar}>
        <Input
          className={css.search ?? ''}
          icon={<IconSearchOutlineRegular size={16} />}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
          placeholder={t('search')}
          aria-label={t('search')}
        />
      </div>
      <div className={css.scrollBody}>
        {error && (
          <p className={css.error} role="alert">
            {t(error)}
          </p>
        )}
        {!data && !error ? (
          <div className={css.skeleton} aria-busy="true" />
        ) : items.length ? (
          <div className={css.grid}>
            {items.map(item => (
              <button
                type="button"
                className={css.card}
                key={`${tab}:${item.id ?? item.name}`}
                aria-label={t('openDetails', { name: item.name })}
                onClick={() => {
                  setDetail(item)
                  setConfirmRemove(false)
                  setRemoveFailed(false)
                }}
              >
                <div className={css.cardHeader}>
                  <SkillIcon icon={item.icon} />
                  <h2>{item.name}</h2>
                </div>
                <p className={css.summary}>{item.description}</p>
                <div className={css.cardFooter}>
                  <span className={css.badge}>{t(tab)}</span>
                  <span className={css.version}>{item.version ? t('versionBadge', { version: item.version }) : t('local')}</span>
                  {(item.loading || !item.enabled || item.error) && (
                    <span>{t(item.loading ? 'loading' : item.error ? 'notReady' : 'disabled')}</span>
                  )}
                  <span className={css.detailsLink}>{t('details')}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          data && <p className={css.empty}>{t(search.trim() ? 'noMatches' : tab === 'personal' ? 'personalEmpty' : 'empty')}</p>
        )}
      </div>
      {detail && (
        <Modal
          open
          onClose={() => {
            if (!removing) setDetail(null)
          }}
          closeLabel={t('close')}
          title={confirmRemove ? t('uninstallTitle') : detail.name}
          className={css.detailModal ?? ''}
          contentClassName={css.detailContent ?? ''}
          footer={
            confirmRemove ? (
              <>
                <Button
                  variant="outline"
                  disabled={removing}
                  onClick={() => {
                    setConfirmRemove(false)
                    setRemoveFailed(false)
                  }}
                >
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={removing}
                  onClick={() => {
                    setRemoving(true)
                    setRemoveFailed(false)
                    void fetch('/api/lfclaw/personal-skills/remove', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: detail.name }),
                    })
                      .then((response) => {
                        if (!response.ok) throw new Error('remove-failed')
                        if (mounted.current) {
                          setDetail(null)
                          setConfirmRemove(false)
                          setAttempt(value => value + 1)
                        }
                      })
                      .catch(() => {
                        if (mounted.current) setRemoveFailed(true)
                      })
                      .finally(() => {
                        if (mounted.current) setRemoving(false)
                      })
                  }}
                >
                  {t(removing ? 'removing' : 'uninstallConfirm')}
                </Button>
              </>
            ) : (
              <>
                {tab === 'personal' && (
                  <>
                    <Button
                      variant="outline"
                      disabled={detail.error}
                      onClick={() => {
                        startChat(t('editPrompt', { name: detail.name }))
                        setDetail(null)
                      }}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setConfirmRemove(true)
                      }}
                    >
                      {t('uninstall')}
                    </Button>
                  </>
                )}
                <Button
                  variant="primary"
                  disabled={!detail.invocationName || !detail.enabled || !detail.userInvocable || detail.error}
                  onClick={() => {
                    if (detail.invocationName) {
                      startChat(skillDraft(detail.name, detail.invocationName))
                      setDetail(null)
                    }
                  }}
                >
                  {t('use')}
                </Button>
              </>
            )
          }
        >
          {confirmRemove ? (
            <>
              <p className={css.fullDescription}>{t('uninstallDescription', { name: detail.name })}</p>
              {removeFailed && <p role="alert">{t('removeFailed')}</p>}
            </>
          ) : (
            <>
              {(!detail.invocationName || !detail.enabled || !detail.userInvocable) && (
                <p role="status" className={css.detailHint}>
                  {t(
                    !detail.enabled
                      ? 'disabled'
                      : !detail.userInvocable
                        ? 'notUserInvocable'
                        : detail.loading
                          ? 'loading'
                          : 'notReady',
                  )}
                </p>
              )}
              <h3>{t('about')}</h3>
              <p className={css.fullDescription}>{detail.description}</p>
              {detail.invocationName && <p className={css.detailHint}>{t('testHint')}</p>}
            </>
          )}
        </Modal>
      )}
      {replacement && (
        <Modal
          open
          title={t('importReplace')}
          closeLabel={t('close')}
          onClose={() => {
            if (!replacing) setReplacement(null)
          }}
          footer={
            <>
              <Button
                variant="outline"
                disabled={replacing}
                onClick={() => {
                  setReplacement(null)
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={replacing}
                onClick={() => {
                  setReplacing(true)
                  void fetch('/api/lfclaw/personal-skills/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/zip', 'If-Match': replacement.revision },
                    body: replacement.file,
                  })
                    .then((response) => {
                      if (!response.ok) {
                        setError(response.status === 409 ? 'conflict' : 'unavailable')
                        return
                      }
                      setReplacement(null)
                      setAttempt(value => value + 1)
                    })
                    .catch(() => {
                      setError('unavailable')
                    })
                    .finally(() => {
                      setReplacing(false)
                    })
                }}
              >
                {t(replacing ? 'busy' : 'importReplace')}
              </Button>
            </>
          }
        >
          <p>{t('replaceConfirm')}</p>
          {error && <p role="alert">{t(error)}</p>}
        </Modal>
      )}
      <input
        ref={file}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const target = event.target
          void (async () => {
            const chosen = target.files?.[0]
            target.value = ''
            if (!chosen || !data || busy) return
            if (chosen.size > data.maxArchiveBytes) {
              setError('archive')
              return
            }
            setBusy(true)
            setError(null)
            try {
              const response = await fetch('/api/lfclaw/personal-skills/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/zip' },
                body: chosen,
              })
              const value: unknown = await response.json()
              if (!mounted.current) return
              if (!response.ok) {
                const code = value && typeof value === 'object' && 'code' in value ? value.code : 'unavailable'
                if (
                  code === 'duplicate' &&
                  value &&
                  typeof value === 'object' &&
                  'revision' in value &&
                  typeof value.revision === 'string'
                ) {
                  setReplacement({ file: chosen, revision: value.revision })
                  return
                }
                setError(code === 'archive' || code === 'metadata' || code === 'duplicate' ? code : 'unavailable')
              } else setAttempt(value => value + 1)
            } catch (_cause) {
              if (mounted.current) setError('unavailable')
            } finally {
              if (mounted.current) setBusy(false)
            }
          })()
        }}
      />
    </section>
  )
}
