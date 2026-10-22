/** Expert discovery and local conversation preparation; creation and editing happen in chat. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Input,
  Modal,
  IconAgentPresetOutlineRegular,
  IconUsersOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { deletePersonalExpert, loadExperts, type EnterpriseExpert, type ExpertCatalog, type PersonalExpert } from './api.ts'
import css from './ExpertsPage.module.css'

/** Page receives conversation actions from the plugin assembly. */
export interface ExpertsPageProps {
  t: TranslateNS<'lfclaw'>
  notify: (text: string) => void
  startChat: (owner: 'enterprise' | 'personal', id: string, task: string) => Promise<void>
  manageExpert: (kind: 'expert' | 'team', expert?: { id: string; name: string }) => void
}
type Expert = EnterpriseExpert | PersonalExpert
type CatalogTab = 'enterprise' | 'personal' | 'personalTeam'
const isTeam = (item: Expert) => item.kind === 'team' || ('source' in item && item.source === 'team')

/** Employee expert catalog. @param props - Localized copy and conversation actions. @returns Expert page. */
export function ExpertsPage({ t, startChat, manageExpert, notify }: ExpertsPageProps): ReactNode {
  const [catalog, setCatalog] = useState<ExpertCatalog | null>(null)
  const [tab, setTab] = useState<CatalogTab>('enterprise')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Expert | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestGeneration = useRef(0)
  const refresh = useCallback(
    async (fresh = true) => {
      const generation = ++requestGeneration.current
      setLoading(true)
      try {
        const result = await loadExperts(fresh)
        if (generation !== requestGeneration.current) return
        setCatalog(result)
        setError('')
      } catch (cause) {
        if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : t('failed'))
      } finally {
        if (generation === requestGeneration.current) setLoading(false)
      }
    },
    [t],
  )
  useEffect(() => {
    void refresh(false)
    return () => {
      requestGeneration.current++
    }
  }, [refresh])
  const owner = tab === 'enterprise' ? 'enterprise' : 'personal'
  const team = tab === 'personalTeam'
  const list = owner === 'enterprise' ? (catalog?.experts ?? []) : (catalog?.personalExperts ?? [])
  const filtered = useMemo(
    () =>
      list.filter(
        item =>
          isTeam(item) === team &&
          [item.name, item.description, ...item.tags].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
    [list, team, search],
  )
  const members = owner === 'enterprise' ? (catalog?.experts ?? []) : (catalog?.personalExperts ?? [])
  const operation = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('failed'))
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    if (!busy) {
      setSelected(null)
      setError('')
    }
  }
  const resourceName = (key: 'skills' | 'connectors', id: string) =>
    catalog?.[key].find(item => item.id === id)?.name ?? t('missing')
  return (
    <section className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}>
            {t('retry')}
          </Button>
          {owner === 'personal' && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                manageExpert(team ? 'team' : 'expert')
              }}
            >
              {t(team ? 'createTeam' : 'create')}
            </Button>
          )}
        </div>
      </header>
      {error && !selected && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      <nav className={css.tabs} role="tablist" aria-label={t('title')}>
        {(['enterprise', 'personal', 'personalTeam'] as const).map(value => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value)
              setSearch('')
            }}
          >
            {t(value)}
          </button>
        ))}
      </nav>
      <div className={css.toolbar}>
        <Input
          className={css.search ?? ''}
          icon={<IconSearchOutlineRegular size={16} />}
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
        />
      </div>
      <div className={css.scrollBody}>
        {loading && !catalog ? (
          <div className={css.skeleton} aria-label={t('loading')} aria-busy="true" />
        ) : (
          <>
            <div className={css.grid}>
              {filtered.map(item => (
                <button
                  type="button"
                  className={css.card}
                  key={item.id}
                  aria-label={t('openDetails', { name: item.name })}
                  onClick={() => {
                    setSelected(item)
                    setConfirmRemove(false)
                    setTask(item.quickPrompts?.[0] ?? '')
                    setError('')
                  }}
                >
                  <div className={css.cardHeader}>
                    <span className={css.expertIcon}>
                      {isTeam(item) ? <IconUsersOutlineRegular size={22} /> : <IconAgentPresetOutlineRegular size={22} />}
                    </span>
                    <h2>{item.name}</h2>
                  </div>
                  <p className={css.summary}>{item.description}</p>
                  <div className={css.cardFooter}>
                    {owner === 'enterprise' && 'source' in item && (
                      <span className={css.source}>
                        {t(
                          item.source === 'bailian'
                            ? 'sourceBailian'
                            : item.source === 'dify'
                              ? 'sourceDify'
                              : item.source === 'weknora'
                                ? 'sourceWeKnora'
                                : item.source === 'external'
                                  ? 'sourceExternal'
                                  : 'sourceOriginal',
                        )}
                      </span>
                    )}
                    <span className={css.detailsLink}>{t('details')}</span>
                  </div>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <p className={css.empty}>
                {search.trim()
                  ? t('noMatches')
                  : t(team ? 'emptyPersonalTeam' : owner === 'enterprise' ? 'emptyEnterprise' : 'emptyPersonal')}
              </p>
            )}
          </>
        )}
      </div>
      {selected && (
        <Modal
          open
          title={confirmRemove ? t('delete') : selected.name}
          closeLabel={t('close')}
          onClose={close}
          className={css.detailModal ?? ''}
          contentClassName={css.detailContent ?? ''}
        >
          <div className={css.editor}>
            {error && (
              <p role="alert" className={css.error}>
                {error}
              </p>
            )}
            {confirmRemove ? (
              <>
                <p>{t('deleteConfirm')}</p>
                <div className={css.editorActions}>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setConfirmRemove(false)
                    }}
                  >
                    {t('cancelDelete')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        await deletePersonalExpert(selected.id)
                        setSelected(null)
                        await refresh()
                        notify(t('removed'))
                      })
                    }
                  >
                    {t('delete')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>{selected.description}</p>
                {selected.instructions && <div className={css.instructions}>{selected.instructions}</div>}
                {isTeam(selected) && (
                  <>
                    <h3>{t('members')}</h3>
                    <ol>
                      {selected.memberIds?.map(id => (
                        <li key={id}>{members.find(item => item.id === id)?.name ?? t('missing')}</li>
                      ))}
                    </ol>
                    <p>{t('teamHint')}</p>
                  </>
                )}
                {!!selected.skillIds?.length && (
                  <div>
                    <h3>{t('skills')}</h3>
                    <p>{selected.skillIds.map(id => resourceName('skills', id)).join('、')}</p>
                  </div>
                )}
                {!!selected.connectorIds?.length && (
                  <div>
                    <h3>{t('connectors')}</h3>
                    <p>{selected.connectorIds.map(id => resourceName('connectors', id)).join('、')}</p>
                  </div>
                )}
                {owner === 'enterprise' && 'source' in selected && selected.source === 'external' ? (
                  <p>{t('remoteHint')}</p>
                ) : (
                  <>
                    <label>
                      {t('task')}
                      <textarea
                        rows={3}
                        maxLength={4000}
                        value={task}
                        onChange={(event) => {
                          setTask(event.target.value)
                        }}
                      />
                    </label>
                    <div className={css.examples}>
                      {selected.quickPrompts?.map(prompt => (
                        <Button
                          key={prompt}
                          variant="ghost"
                          onClick={() => {
                            setTask(prompt)
                          }}
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                    <p>{t('startHint')}</p>
                    <Button
                      variant="primary"
                      disabled={busy || !task.trim()}
                      onClick={() => void operation(() => startChat(owner, selected.id, task.trim()))}
                    >
                      {t('start')}
                    </Button>
                  </>
                )}
                {owner === 'personal' && (
                  <div className={css.editorActions}>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        manageExpert(isTeam(selected) ? 'team' : 'expert', { id: selected.id, name: selected.name })
                      }}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmRemove(true)
                      }}
                    >
                      {t('delete')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}
