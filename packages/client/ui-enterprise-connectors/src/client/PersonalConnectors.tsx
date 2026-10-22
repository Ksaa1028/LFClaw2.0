/** Current employee's local MCP configuration forms and management actions. */
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Input,
  Modal,
  Switch,
  IconLinkOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectorCenterKey } from './locales.ts'
import css from './ConnectorsPage.module.css'

interface Item {
  id: string
  revision: string
  name: string
  enabled: boolean
  connected: boolean
  transport: 'sse' | 'streamable-http' | 'stdio'
  url: string
  command: string
  args: string[]
  headers: Record<string, string>
  env: Record<string, string>
  auth?: 'manual' | 'oauth'
  clientId?: string
  issuer?: string
  scopes?: string
  authorizationRequired?: boolean
  tools: { name: string; description: string }[]
}
interface Draft {
  id?: string
  revision?: string
  name: string
  enabled: boolean
  transport: Item['transport']
  url: string
  command: string
  args: string
  headers: string
  env: string
  auth?: 'manual' | 'oauth'
  clientId?: string
  issuer?: string
  scopes?: string
}
const fresh = (): Draft => ({
  name: '',
  enabled: true,
  transport: 'streamable-http',
  url: '',
  command: '',
  args: '[]',
  headers: '{}',
  env: '{}',
})
function edit(item: Item): Draft {
  return {
    ...item,
    args: JSON.stringify(item.args, null, 2),
    headers: JSON.stringify(item.headers, null, 2),
    env: JSON.stringify(item.env, null, 2),
  }
}
const errorKeys: Record<string, ConnectorCenterKey> = {
  invalid: 'invalidConfig',
  conflict: 'configConflict',
  storage: 'storageError',
  protected: 'protectedConnector',
  unavailable: 'personalUnavailable',
  transportRejected: 'transportRejected',
  authorizationRequired: 'accountReauthorize',
}
class RequestFailure extends Error {
  constructor(readonly key: ConnectorCenterKey) {
    super(key)
  }
}

/** Manage personal connectors while keeping transient feedback in the owning page.
 * @param props - localized copy, chat action, page-owned outcome reporting, and optional header action container.
 * @returns personal catalog and its forms.
 */
export function PersonalConnectors({
  t,
  startChat,
  notify,
  actionsTarget,
}: {
  actionsTarget?: HTMLDivElement | null
  t: TranslateNS<'connectorCenter'>
  startChat: (name: string) => void
  notify: (message: string) => void
}): ReactNode {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<ConnectorCenterKey | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<Item | null>(null)
  const [removing, setRemoving] = useState<Item | null>(null)
  const [formError, setFormError] = useState<ConnectorCenterKey | null>(null)
  const [tested, setTested] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const lifetime = useRef(new AbortController())
  async function request(body?: object): Promise<unknown> {
    const response = await fetch('/api/lfclaw/personal-connectors', {
      method: body ? 'POST' : 'GET',
      signal: lifetime.current.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const value: unknown = await response.json()
    if (!response.ok) {
      if (response.status === 401) {
        setItems(null)
        setSelected(null)
        setDraft(null)
        setRemoving(null)
      }
      const code =
        value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : 'unavailable'
      throw new RequestFailure(errorKeys[code] ?? 'personalUnavailable')
    }
    return value
  }
  async function load(): Promise<void> {
    try {
      const value = await request()
      if (!value || typeof value !== 'object' || !('connectors' in value) || !Array.isArray(value.connectors))
        throw new Error('personalUnavailable')
      const next = value.connectors.map((raw: unknown): Item => {
        if (
          !raw ||
          typeof raw !== 'object' ||
          !('id' in raw) ||
          typeof raw.id !== 'string' ||
          !('name' in raw) ||
          typeof raw.name !== 'string' ||
          !('revision' in raw) ||
          typeof raw.revision !== 'string' ||
          !('tools' in raw) ||
          !Array.isArray(raw.tools) ||
          !('enabled' in raw) ||
          typeof raw.enabled !== 'boolean' ||
          !('transport' in raw) ||
          !['stdio', 'sse', 'streamable-http'].includes(String(raw.transport)) ||
          !('connected' in raw) ||
          typeof raw.connected !== 'boolean' ||
          !('url' in raw) ||
          typeof raw.url !== 'string' ||
          !('command' in raw) ||
          typeof raw.command !== 'string' ||
          !('args' in raw) ||
          !Array.isArray(raw.args) ||
          !raw.args.every(arg => typeof arg === 'string') ||
          !('headers' in raw) ||
          !raw.headers ||
          typeof raw.headers !== 'object' ||
          Array.isArray(raw.headers) ||
          !Object.values(raw.headers).every(value => typeof value === 'string') ||
          !('env' in raw) ||
          !raw.env ||
          typeof raw.env !== 'object' ||
          Array.isArray(raw.env) ||
          !Object.values(raw.env).every(value => typeof value === 'string') ||
          raw.tools.some(
            (tool: unknown) =>
              !tool ||
              typeof tool !== 'object' ||
              !('name' in tool) ||
              typeof tool.name !== 'string' ||
              !('description' in tool) ||
              typeof tool.description !== 'string',
          )
        )
          throw new Error('personalUnavailable')
        return raw as Item
      })
      if (!lifetime.current.signal.aborted) {
        setItems(next)
        setError(null)
        setSelected(prior => (prior ? (next.find(item => item.id === prior.id) ?? null) : null))
      }
    } catch {
      if (!lifetime.current.signal.aborted) setError('personalUnavailable')
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void load()
    const refresh = () => {
      void load()
    }
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [])
  async function act(body: object, success: string): Promise<void> {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      await request(body)
      if (lifetime.current.signal.aborted) return
      setDraft(null)
      setRemoving(null)
      setSelected(null)
      notify(success)
      await load()
    } catch (caught) {
      if (!lifetime.current.signal.aborted) setFormError(caught instanceof RequestFailure ? caught.key : 'personalUnavailable')
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false)
    }
  }
  function formItem(): object {
    if (!draft) throw new Error('invalidConfig')
    return { ...draft, args: JSON.parse(draft.args), headers: JSON.parse(draft.headers), env: JSON.parse(draft.env) }
  }
  async function submit(test: boolean): Promise<void> {
    let item: object
    try {
      item = formItem()
    } catch {
      setFormError('invalidConfig')
      return
    }
    if (!test) {
      await act({ operation: 'save', item }, t('saved'))
      return
    }
    setBusy(true)
    setFormError(null)
    setTested(null)
    try {
      const value = await request({ operation: 'test', item })
      if (value && typeof value === 'object' && 'tools' in value && Array.isArray(value.tools)) setTested(value.tools.length)
    } catch (caught) {
      if (!lifetime.current.signal.aborted) setFormError(caught instanceof RequestFailure ? caught.key : 'personalUnavailable')
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false)
    }
  }
  async function authorize(item: Item): Promise<void> {
    setBusy(true)
    setFormError(null)
    try {
      const result = await request({ operation: 'oauth', id: item.id, revision: item.revision })
      if (!result || typeof result !== 'object' || !('authorizationUrl' in result) || typeof result.authorizationUrl !== 'string')
        throw new Error('invalid')
      const url = new URL(result.authorizationUrl)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        throw new Error('invalid')
      setAuthorizationUrl(url.href)
      window.open(url.href, '_blank', 'noopener,noreferrer')
    } catch {
      setFormError('accountFailed')
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false)
    }
  }
  const change = (values: Partial<Draft>) => {
    setDraft(prior => (prior ? { ...prior, ...values } : prior))
    setTested(null)
    setFormError(null)
  }
  const shown = (items ?? []).filter(item =>
    `${item.name} ${item.url} ${item.tools.map(tool => tool.name).join(' ')}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  )
  const actions = (
    <div className={css.actions}>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          void act({ operation: 'refresh' }, t('refreshed'))
        }}
      >
        {t('refresh')}
      </Button>
      <Button
        variant="primary"
        onClick={() => {
          setDraft(fresh())
          setFormError(null)
          setTested(null)
        }}
      >
        {t('createConnector')}
      </Button>
    </div>
  )
  return (
    <>
      {actionsTarget ? createPortal(actions, actionsTarget) : actions}
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
        {!items && !error ? (
          <div className={css.skeleton} aria-busy="true" />
        ) : shown.length ? (
          <div className={css.grid}>
            {shown.map(item => (
              <button
                type="button"
                className={css.card}
                key={item.id}
                onClick={() => {
                  setSelected(item)
                  setAuthorizationUrl('')
                  setFormError(null)
                }}
              >
                <span className={css.icon}>
                  <IconLinkOutlineRegular size={22} />
                </span>
                <span className={css.cardContent}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.transport} ·{' '}
                    {t(
                      !item.enabled
                        ? 'disabled'
                        : item.connected
                          ? 'ready'
                          : item.authorizationRequired
                            ? 'accountRequired'
                            : 'connectionFailed',
                    )}
                  </span>
                </span>
                <span className={css.count}>{t('toolCount', { count: item.tools.length })}</span>
                <span className={css.details}>{t('details')}</span>
              </button>
            ))}
          </div>
        ) : (
          items && <p className={css.empty}>{t(search ? 'noMatches' : 'emptyPersonal')}</p>
        )}
      </div>
      {selected && (
        <Modal
          open
          onClose={() => {
            if (!busy) setSelected(null)
          }}
          title={selected.name}
          closeLabel={t('close')}
          className={css.modal ?? ''}
          contentClassName={css.modalContent ?? ''}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRemoving(selected)
                  setFormError(null)
                }}
              >
                {t('remove')}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(edit(selected))
                  setTested(null)
                  setSelected(null)
                }}
              >
                {t('edit')}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !selected.enabled || !selected.connected}
                onClick={() => {
                  startChat(selected.name)
                  setSelected(null)
                }}
              >
                {t('useConnector')}
              </Button>
            </>
          }
        >
          <div className={css.setting}>
            <span>{t('enabled')}</span>
            <Switch
              label={t('enabled')}
              checked={selected.enabled}
              disabled={busy}
              onChange={(enabled) => {
                void act({ operation: 'save', item: { ...selected, enabled } }, t('saved'))
              }}
            />
          </div>
          <p className={css.toolEmpty}>{selected.transport === 'stdio' ? selected.command : selected.url}</p>
          {selected.auth === 'oauth' && (
            <div className={css.actions}>
              <Button
                disabled={busy || !selected.enabled}
                onClick={() => {
                  void authorize(selected)
                }}
              >
                {t('oauthConnect')}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !selected.enabled}
                onClick={() => {
                  void act({ operation: 'disconnect', id: selected.id, revision: selected.revision }, t('accountRemoved'))
                }}
              >
                {t('accountRemove')}
              </Button>
            </div>
          )}
          {authorizationUrl && (
            <p>
              {t('oauthWaiting')}{' '}
              <a href={authorizationUrl} target="_blank" rel="noreferrer">
                {t('oauthOpen')}
              </a>
            </p>
          )}
          <ul className={css.tools}>
            {selected.tools.map(tool => (
              <li key={tool.name}>
                <strong>{tool.name}</strong>
                <span>{tool.description}</span>
              </li>
            ))}
          </ul>
          {formError && (
            <p className={css.notice} role="alert">
              {t(formError)}
            </p>
          )}
        </Modal>
      )}
      {draft && (
        <Modal
          open
          onClose={() => {
            if (!busy) setDraft(null)
          }}
          title={t(draft.id ? 'editConnector' : 'createConnector')}
          closeLabel={t('close')}
          className={css.modal ?? ''}
          contentClassName={css.modalContent ?? ''}
          footer={
            <>
              <Button
                variant="outline"
                disabled={busy || draft.auth === 'oauth'}
                onClick={() => {
                  void submit(true)
                }}
              >
                {t('check')}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !draft.name.trim()}
                onClick={() => {
                  void submit(false)
                }}
              >
                {t('save')}
              </Button>
            </>
          }
        >
          <div className={css.form}>
            <label>
              {t('connectorName')}
              <Input
                value={draft.name}
                disabled={busy}
                onChange={(event) => {
                  change({ name: event.target.value })
                }}
              />
            </label>
            <label>
              {t('transport')}
              <select
                value={draft.transport}
                disabled={busy}
                onChange={(event) => {
                  change({
                    transport: event.target.value as Item['transport'],
                    auth: 'manual',
                  })
                }}
              >
                <option value="streamable-http">{t('streamableHttp')}</option>
                <option value="sse">{t('sse')}</option>
                <option value="stdio">{t('stdio')}</option>
              </select>
            </label>
            {draft.transport !== 'stdio' && (
              <>
                <label>
                  {t('authentication')}
                  <select
                    value={draft.auth ?? 'manual'}
                    disabled={busy}
                    onChange={(event) => {
                      change({ auth: event.target.value as 'manual' | 'oauth' })
                    }}
                  >
                    <option value="manual">{t('manualAuthentication')}</option>
                    <option value="oauth">{t('oauthAuthentication')}</option>
                  </select>
                </label>
                {draft.auth === 'oauth' && (
                  <>
                    <p className={css.toolEmpty}>{t('personalOAuthHint')}</p>
                    <label>
                      {t('oauthClientId')}
                      <Input
                        value={draft.clientId ?? ''}
                        onChange={(event) => {
                          change({ clientId: event.target.value })
                        }}
                      />
                    </label>
                    <label>
                      {t('oauthIssuer')}
                      <Input
                        value={draft.issuer ?? ''}
                        onChange={(event) => {
                          change({ issuer: event.target.value })
                        }}
                      />
                    </label>
                    <label>
                      {t('oauthScopes')}
                      <Input
                        value={draft.scopes ?? ''}
                        onChange={(event) => {
                          change({ scopes: event.target.value })
                        }}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {draft.transport === 'stdio' ? (
              <>
                <label>
                  {t('command')}
                  <Input
                    value={draft.command}
                    disabled={busy}
                    onChange={(event) => {
                      change({ command: event.target.value })
                    }}
                  />
                </label>
                <label>
                  {t('arguments')}
                  <textarea
                    value={draft.args}
                    disabled={busy}
                    onChange={(event) => {
                      change({ args: event.target.value })
                    }}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
                <label>
                  {t('environment')}
                  <textarea
                    value={draft.env}
                    disabled={busy}
                    onChange={(event) => {
                      change({ env: event.target.value })
                    }}
                    rows={3}
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  {t('endpoint')}
                  <Input
                    value={draft.url}
                    disabled={busy}
                    onChange={(event) => {
                      change({ url: event.target.value })
                    }}
                  />
                </label>
                <label>
                  {t('headers')}
                  <textarea
                    value={draft.headers}
                    disabled={busy}
                    onChange={(event) => {
                      change({ headers: event.target.value })
                    }}
                    rows={4}
                    spellCheck={false}
                  />
                </label>
              </>
            )}
            <p className={css.toolEmpty}>{t('secretsHint')}</p>
            <div className={css.setting}>
              <span>{t('enabled')}</span>
              <Switch
                label={t('enabled')}
                checked={draft.enabled}
                disabled={busy}
                onChange={(enabled) => {
                  change({ enabled })
                }}
              />
            </div>
            {formError && (
              <p className={css.notice} role="alert">
                {t(formError)}
              </p>
            )}
            {tested !== null && (
              <p className={css.notice} role="status">
                {t('testSuccess', { count: tested })}
              </p>
            )}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal
          open
          onClose={() => {
            if (!busy) setRemoving(null)
          }}
          title={t('remove')}
          closeLabel={t('close')}
          footer={
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void act({ operation: 'remove', id: removing.id, revision: removing.revision }, t('removed'))
              }}
            >
              {t('confirmRemove')}
            </Button>
          }
        >
          <p>{t('removeConfirm', { name: removing.name })}</p>
          {formError && <p role="alert">{t(formError)}</p>}
        </Modal>
      )}
    </>
  )
}
