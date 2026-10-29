/** Authorized connector list and live tool discovery. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Input,
  Modal,
  Toast,
  IconLinkOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectorCenterKey } from './locales.ts'
import css from './ConnectorsPage.module.css'
import { PersonalConnectors } from './PersonalConnectors.tsx'
import { ConnectorAccountForm } from './ConnectorAccountForm.tsx'
import { parseConnectorAccount, type ConnectorSummary } from '../catalog.ts'

interface Tool {
  id: string
  name: string
  description: string
}
interface Connector {
  id: string
  name: string
  type: string
  icon: string
  showToolsInClient: boolean
  hasAvailableTools: boolean
  tools: Tool[]
  dataPermissions?: string[]
  account?: ConnectorSummary['account']
}
interface Catalog {
  connectors: Connector[]
  refreshIntervalMs: number
  revision?: string
}

const permissionLabels: Record<string, ConnectorCenterKey> = {
  'operation.floor.1': 'floor1',
  'operation.floor.2': 'floor2',
  'operation.floor.3': 'floor3',
  'operation.floor.4': 'floor4',
  'operation.self_operated': 'selfOperated',
}

function parseCatalog(value: unknown): Catalog {
  if (
    !value ||
    typeof value !== 'object' ||
    !('connectors' in value) ||
    !Array.isArray(value.connectors) ||
    !('refreshIntervalMs' in value) ||
    typeof value.refreshIntervalMs !== 'number' ||
    value.refreshIntervalMs < 1000
  )
    throw new Error('catalog')
  const connectors = value.connectors.map((raw: unknown): Connector => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('id' in raw) ||
      typeof raw.id !== 'string' ||
      !('name' in raw) ||
      typeof raw.name !== 'string' ||
      !('type' in raw) ||
      typeof raw.type !== 'string' ||
      ('showToolsInClient' in raw && typeof raw.showToolsInClient !== 'boolean') ||
      ('hasAvailableTools' in raw && typeof raw.hasAvailableTools !== 'boolean') ||
      ('icon' in raw && typeof raw.icon !== 'string') ||
      !('tools' in raw) ||
      !Array.isArray(raw.tools)
    )
      throw new Error('catalog')
    const tools = raw.tools.map((tool: unknown): Tool => {
      if (
        !tool ||
        typeof tool !== 'object' ||
        !('id' in tool) ||
        typeof tool.id !== 'string' ||
        !('name' in tool) ||
        typeof tool.name !== 'string' ||
        !('description' in tool) ||
        typeof tool.description !== 'string'
      )
        throw new Error('catalog')
      return { id: tool.id, name: tool.name, description: tool.description }
    })
    if (
      'dataPermissions' in raw &&
      (!Array.isArray(raw.dataPermissions) ||
        raw.dataPermissions.some(item => typeof item !== 'string' || !Object.hasOwn(permissionLabels, item)))
    )
      throw new Error('catalog')
    const account = parseConnectorAccount('account' in raw ? raw.account : undefined)
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      icon: 'icon' in raw ? (raw.icon as string) : '',
      showToolsInClient: 'showToolsInClient' in raw ? (raw.showToolsInClient as boolean) : false,
      tools,
      ...(account ? { account } : {}),
      hasAvailableTools:
        account?.configured !== false && ('hasAvailableTools' in raw ? (raw.hasAvailableTools as boolean) : tools.length > 0),
      ...('dataPermissions' in raw ? { dataPermissions: raw.dataPermissions as string[] } : {}),
    }
  })
  if ('revision' in value && (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)))
    throw new Error('catalog')
  return {
    connectors,
    refreshIntervalMs: value.refreshIntervalMs,
    ...('revision' in value ? { revision: value.revision as string } : {}),
  }
}

/**
 * Render the employee's authorized connectors.
 * @param props Localized copy, chat action, and personal setup request.
 * @returns the connector page.
 */
export function ConnectorsPage({
  t,
  startChat,
}: {
  t: TranslateNS<'connectorCenter'>
  startChat: (name: string) => void
}): ReactNode {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<ConnectorCenterKey | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [check, setCheck] = useState<'idle' | 'pending' | 'ok' | 'failed'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null)
  const [tab, setTab] = useState<'enterprise' | 'personal'>('enterprise')
  const [notice, setNotice] = useState<{ message: string; sequence: number } | null>(null)
  const checkGeneration = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    let revision: string | undefined
    let summary = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const response = await fetch(
          `/api/lfclaw/connector-center${summary ? `?summary=1${attempt ? '&refresh=1' : ''}` : revision ? `?revision=${revision}` : '?refresh=1'}`,
          { signal: controller.signal, cache: 'no-store' },
        )
        if (response.status === 401 || response.status === 403) {
          setCatalog(null)
          setSelectedId(null)
        }
        if (!response.ok) throw new Error('catalog')
        const value: unknown = await response.json()
        const pendingIcons = value !== null && typeof value === 'object' && 'summary' in value && value.summary === true
        const next = parseCatalog(value)
        if (controller.signal.aborted) return
        if (revision && next.revision !== revision) {
          checkGeneration.current++
          setCheck('idle')
        }
        summary = false
        revision = pendingIcons ? undefined : next.revision
        setCatalog(next)
        setError(null)
        timer = setTimeout(
          () => {
            void load()
          },
          pendingIcons || revision ? 0 : next.refreshIntervalMs,
        )
      } catch {
        if (!controller.signal.aborted) {
          checkGeneration.current++
          revision = undefined
          setCatalog(null)
          setSelectedId(null)
          setCheck('idle')
          setError('unavailable')
          timer = setTimeout(() => {
            void load()
          }, catalog?.refreshIntervalMs ?? 30000)
        }
      }
    }
    void load()
    return () => {
      checkGeneration.current++
      controller.abort()
      clearTimeout(timer)
    }
  }, [attempt])
  const selected = catalog?.connectors.find(item => item.id === selectedId)
  const query = search.toLocaleLowerCase().trim()
  const shown = (catalog?.connectors ?? []).filter(item =>
    `${item.name} ${item.type} ${item.tools.map(tool => `${tool.name} ${tool.description}`).join(' ')}`
      .toLocaleLowerCase()
      .includes(query),
  )
  const checkConnection = async (id: string) => {
    const generation = ++checkGeneration.current
    setCheck('pending')
    try {
      const response = await fetch(`/api/lfclaw/connector-center?id=${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error('connector')
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object' || !('tools' in value) || !Array.isArray(value.tools)) throw new Error('connector')
      if (generation === checkGeneration.current) setCheck('ok')
    } catch {
      if (generation === checkGeneration.current) setCheck('failed')
    }
  }
  return (
    <section className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={css.actions} ref={setActionsTarget}>
          {tab === 'enterprise' && (
            <Button
              variant="outline"
              onClick={() => {
                setAttempt(value => value + 1)
              }}
            >
              {t('refresh')}
            </Button>
          )}
        </div>
      </header>
      <nav className={css.tabs} aria-label={t('sources')}>
        <button
          type="button"
          aria-current={tab === 'enterprise' ? 'page' : undefined}
          onClick={() => {
            setTab('enterprise')
          }}
        >
          {t('enterprise')}
        </button>
        <button
          type="button"
          aria-current={tab === 'personal' ? 'page' : undefined}
          onClick={() => {
            setTab('personal')
          }}
        >
          {t('personal')}
        </button>
      </nav>
      <div className={css.catalogBody}>
        {tab === 'personal' ? (
          <PersonalConnectors
            actionsTarget={actionsTarget}
            t={t}
            startChat={startChat}
            notify={(message) => {
              setNotice(prior => ({ message, sequence: (prior?.sequence ?? 0) + 1 }))
            }}
          />
        ) : (
          <>
            <div className={css.toolbar}>
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
                icon={<IconSearchOutlineRegular size={16} />}
                placeholder={t('search')}
                aria-label={t('search')}
              />
            </div>
            <div className={css.scrollBody}>
              {error && (
                <p className={css.notice} role="alert">
                  {t(error)}
                </p>
              )}
              {!catalog && !error ? (
                <div className={css.skeleton} aria-busy="true" />
              ) : shown.length ? (
                <div className={css.grid}>
                  {shown.map(item => (
                    <button
                      type="button"
                      className={css.card}
                      key={item.id}
                      onClick={() => {
                        checkGeneration.current++
                        setSelectedId(item.id)
                        setCheck('idle')
                      }}
                    >
                      <span className={css.icon}>
                        {item.icon ? <img src={item.icon} alt="" /> : <IconLinkOutlineRegular size={22} />}
                      </span>
                      <span className={css.cardContent}>
                        <strong>{item.name}</strong>
                        <span>{item.type}</span>
                        {item.account && <span>{t(item.account.configured ? 'accountConfigured' : 'accountRequired')}</span>}
                        {item.dataPermissions && (
                          <span>
                            {t('dataScope')}
                            {item.dataPermissions.length
                              ? item.dataPermissions
                                .map(permission => t(permissionLabels[permission] ?? 'noDataScope'))
                                .join('、')
                              : t('noDataScope')}
                          </span>
                        )}
                      </span>
                      {item.showToolsInClient && (
                        <span className={css.count}>{t('toolCount', { count: item.tools.length })}</span>
                      )}
                      <span className={css.details}>{t('details')}</span>
                    </button>
                  ))}
                </div>
              ) : (
                catalog && <p className={css.empty}>{t(query ? 'noMatches' : 'empty')}</p>
              )}
              {selected && (
                <Modal
                  open
                  onClose={() => {
                    checkGeneration.current++
                    setSelectedId(null)
                  }}
                  closeLabel={t('close')}
                  title={selected.name}
                  className={css.modal ?? ''}
                  contentClassName={css.modalContent ?? ''}
                  footer={
                    <>
                      <Button
                        variant="outline"
                        disabled={!selected.hasAvailableTools || check === 'pending'}
                        onClick={() => {
                          void checkConnection(selected.id)
                        }}
                      >
                        {t(check === 'pending' ? 'checking' : 'check')}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={!selected.hasAvailableTools}
                        onClick={() => {
                          checkGeneration.current++
                          setSelectedId(null)
                          startChat(selected.name)
                        }}
                      >
                        {t('useConnector')}
                      </Button>
                    </>
                  }
                >
                  {selected.account && (
                    <ConnectorAccountForm
                      key={`${selected.id}:${JSON.stringify(selected.account)}`}
                      id={selected.id}
                      configured={selected.account.configured}
                      account={selected.account}
                      t={t}
                      onChanged={(message) => {
                        setNotice(prior => ({ message, sequence: (prior?.sequence ?? 0) + 1 }))
                        setAttempt(value => value + 1)
                      }}
                    />
                  )}
                  {selected.showToolsInClient && <h3>{t('tools')}</h3>}
                  {selected.dataPermissions && (
                    <p>
                      {t('dataScope')}
                      {selected.dataPermissions.length
                        ? selected.dataPermissions
                          .map(permission => t(permissionLabels[permission] ?? 'noDataScope'))
                          .join('、')
                        : t('noDataScope')}
                    </p>
                  )}
                  {!selected.hasAvailableTools ? (
                    <p className={css.toolEmpty} role="status">
                      {t(selected.account?.configured === false ? 'accountRequired' : 'noTools')}
                    </p>
                  ) : !selected.showToolsInClient ? (
                    <p className={css.toolEmpty}>{t('toolsHidden')}</p>
                  ) : selected.tools.length ? (
                    <ul className={css.tools}>
                      {selected.tools.map(tool => (
                        <li key={tool.id}>
                          <strong>{tool.name}</strong>
                          {tool.description && <span>{tool.description}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={css.toolEmpty}>{t('noTools')}</p>
                  )}
                  {check === 'ok' && (
                    <p className={css.notice} role="status">
                      {t('connected')}
                    </p>
                  )}
                  {check === 'failed' && (
                    <p className={css.notice} role="alert">
                      {t('disconnected')}
                    </p>
                  )}
                </Modal>
              )}
            </div>
          </>
        )}
      </div>
      {notice && (
        <Toast
          key={notice.sequence}
          text={notice.message}
          tone="success"
          onDone={() => {
            setNotice(null)
          }}
        />
      )}
    </section>
  )
}
