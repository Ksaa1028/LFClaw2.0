import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  IconEditOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DataTable } from '../components/DataTable.tsx'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import { ScopePicker } from '../components/ScopePicker.tsx'
import type { Column } from '../components/DataTable.tsx'
import type { Connector } from '../mock/data.ts'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './ConnectorsPage.module.css'
import { testConnector as testConnectorApi } from '../api.ts'
import { loadData } from '../api.ts'
import { ConnectorAuthenticationEditor, authenticationFor } from './ConnectorAuthentication.tsx'
import { ConnectorAccountDialog } from './ConnectorAccountDialog.tsx'

export interface ConnectorsPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

function newHeaderName(headers: Record<string, string>): string {
  let index = 1
  while (Object.hasOwn(headers, `X-Custom-${index}`)) index += 1
  return `X-Custom-${index}`
}

export function ConnectorsPage({ t, showToast }: ConnectorsPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const [editing, setEditing] = useState<Connector | null>(null)
  const [deleting, setDeleting] = useState<Connector | null>(null)
  const [testing, setTesting] = useState<Connector | null>(null)
  const [accountConnector, setAccountConnector] = useState<Connector | null>(null)
  const [unverifiedTools, setUnverifiedTools] = useState<number | null>(null)
  const [testingBusy, setTestingBusy] = useState(false)
  const [form, setForm] = useState<Partial<Connector>>({})
  const [argsText, setArgsText] = useState('[]')
  const [envText, setEnvText] = useState('{}')
  const [saving, setSaving] = useState(false)
  const iconReader = useRef<FileReader | null>(null)
  const [iconReading, setIconReading] = useState(false)
  useEffect(() => () => { iconReader.current?.abort() }, [])

  const openAdd = useCallback(() => {
    iconReader.current?.abort(); iconReader.current = null; setIconReading(false)
    setEditing(null)
    setArgsText('[]'); setEnvText('{}')
    setForm({ name: '', enabled: true, showToolsInClient: true, type: 'mcp', transport: 'streamable-http',
      mallDataPermissions: false, headers: {}, icon: '', scope: 'all', scopeTarget: [], tools: [] })
  }, [])

  const openEdit = useCallback((conn: Connector) => {
    iconReader.current?.abort(); iconReader.current = null; setIconReading(false)
    setEditing(conn)
    setArgsText(JSON.stringify(conn.args ?? [], null, 2)); setEnvText(JSON.stringify(conn.env ?? {}, null, 2))
    setForm({ ...conn, transport: conn.transport ?? 'sse', mallDataPermissions: conn.mallDataPermissions ?? false,
      headers: conn.headers ?? {}, showToolsInClient: conn.showToolsInClient ?? conn.showInClient ?? true })
  }, [])

  const closeForm = useCallback(() => {
    if (saving) return
    iconReader.current?.abort(); iconReader.current = null; setIconReading(false)
    setEditing(null); setForm({})
  }, [saving])

  const save = useCallback(async () => {
    if (saving) return
    const name = (form.name ?? '').trim()
    if (name === '') return
    const stdio = form.transport === 'stdio'
    let args: string[] = []
    let env: Record<string, string> = {}
    if (stdio) {
      try {
        const parsedArgs: unknown = JSON.parse(argsText)
        const parsedEnv: unknown = JSON.parse(envText)
        if (!(form.command ?? '').trim() || !Array.isArray(parsedArgs) || !parsedArgs.every(arg => typeof arg === 'string')
          || !parsedEnv || typeof parsedEnv !== 'object' || Array.isArray(parsedEnv)
          || !Object.entries(parsedEnv).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string')) {
          showToast(t('connectors.stdioInvalid')); return
        }
        args = parsedArgs
        env = Object.fromEntries(Object.entries(parsedEnv))
        if (form.employeeCredentials === 'wechat-mp') {
          env = Object.fromEntries(Object.entries(env).filter(([key]) => !['WECHAT_APP_ID', 'WECHAT_APP_SECRET'].includes(key.toUpperCase())))
        }
        const credentialNames = new Set(authenticationFor(form).fields.filter(field => field.target === 'env').map(field => field.name.toUpperCase()))
        env = Object.fromEntries(Object.entries(env).filter(([key]) => !credentialNames.has(key.toUpperCase())))
      } catch {
        showToast(t('connectors.stdioInvalid')); return
      }
    }
    if (!stdio && Object.entries(form.headers ?? {}).some(([name, value]) =>
      !name.trim() || !value && !(editing?.headers && Object.hasOwn(editing.headers, name)
        && editing.endpoint === form.endpoint))) {
      showToast(t('connectors.headerValueRequired')); return
    }
    setSaving(true)
    const payload: Connector = {
      id: editing?.id ?? 'c-' + Date.now(),
      name,
      type: (form.type ?? 'mcp').trim(),
      endpoint: stdio ? '' : (form.endpoint ?? '').trim(),
      transport: form.transport ?? 'sse',
      ...(stdio ? { command: (form.command ?? '').trim(), args } : {}),
      env: stdio ? env : {},
      employeeCredentials: stdio ? form.employeeCredentials ?? 'shared' : 'shared',
      ...(form.authentication ? { authentication: form.authentication, employeeCredentials: 'shared' as const } : {}),
      mallDataPermissions: form.mallDataPermissions === true,
      headers: stdio ? {} : form.headers ?? {},
      icon: form.icon ?? '',
      enabled: form.enabled ?? false,
      showToolsInClient: form.showToolsInClient !== false,
      tools: form.tools ?? [],
      scope: form.scope ?? 'all',
      scopeTarget: (form.scope === 'all' || form.scope === 'none') ? [] : form.scopeTarget ?? [],
    }
    try {
      const ok = await dispatch(editing != null ? { type: 'UPDATE_CONNECTOR', payload } : { type: 'ADD_CONNECTOR', payload })
      if (ok) { showToast(t('save'), 'success'); setEditing(null); setForm({}) }
    } finally { setSaving(false) }
  }, [saving, editing, form, argsText, envText, dispatch, showToast, t])

  const confirmDelete = useCallback(async () => {
    if (deleting == null) return
    if (await dispatch({ type: 'DELETE_CONNECTOR', payload: deleting.id })) { showToast(t('delete'), 'success'); setDeleting(null) }
  }, [deleting, dispatch, showToast, t])

  const testConnector = useCallback(async () => {
    if (testing == null || testingBusy) return
    setTestingBusy(true)
    try {
      const result = await testConnectorApi(testing.id)
      const tools = result.tools.map(tool => ({ id: tool.name, name: tool.name,
        description: tool.description ?? '', allowed: !testing.mallDataPermissions || (testing.tools.find(item => item.name === tool.name)?.allowed ?? false) }))
      if (await dispatch({ type: 'UPDATE_CONNECTOR', payload: { ...testing, tools } })) {
        if (result.verified) {
          showToast(t('connectors.testSuccess', { count: tools.length }), 'success')
          setUnverifiedTools(null)
          setTesting(null)
        } else setUnverifiedTools(tools.length)
      }
    } catch (error) { showToast(error instanceof Error ? error.message : t('connectors.testFailed')) }
    finally { setTestingBusy(false) }
  }, [testing, testingBusy, dispatch, showToast, t])

  const toggleEnabled = useCallback(async (conn: Connector) => {
    const updated = { ...conn, enabled: !conn.enabled }
    await dispatch({ type: 'UPDATE_CONNECTOR', payload: updated })
  }, [dispatch])

  const columns: Column<Connector>[] = useMemo(() => [
    { key: 'name', title: t('name'), render: row => <span className={css.connectorName}>
      <span className={css.connectorIcon}>{row.icon ? <img src={row.icon} alt="" /> : row.name.slice(0, 1)}</span>
      <span className={css.connectorIdentity}><span>{row.name}</span>
        {row.mallDataPermissions && <Tag tone="success">{t('connectors.floorPermissions')}</Tag>}
      </span></span> },
    { key: 'type', title: t('type'), render: row => row.type === 'mcp' ? t('connectors.typeMcp') : row.type },
    { key: 'tools', title: t('connectors.toolCount'), render: row => row.tools.length },
    { key: 'clientVisibility', title: t('connectors.clientVisibility'), render: row =>
      <Tag tone={(row.showToolsInClient ?? row.showInClient) !== false ? 'success' : 'danger'}>{(row.showToolsInClient ?? row.showInClient) !== false ? t('connectors.shown') : t('connectors.hidden')}</Tag> },
    {
      key: 'status',
      title: t('status'),
      render: row => <Tag tone={row.enabled ? 'success' : 'danger'}>{row.enabled ? t('enabled') : t('disabled')}</Tag>,
    },
    { key: 'scope', title: t('models.scope'), render: row => row.scope === 'none' ? t('distribution.none') : row.scope === 'department' || row.scope === 'employee'
      ? `${row.scope === 'department' ? t('distribution.departments') : t('distribution.employees')} · ${row.scopeTarget?.length ?? 0}`
      : t('distribution.all') },
    {
      key: 'actions',
      title: t('actions'),
      width: '220px',
      render: row => (
        <span className={css.actions}>
          <Button size="sm" variant="ghost" icon={<IconEditOutlineRegular size={14} />} onClick={() => openEdit(row)}>{t('edit')}</Button>
          <Button size="sm" variant="ghost" icon={<IconPlayOutlineRegular size={14} />} onClick={() => {
            setUnverifiedTools(null); setTesting(row)
          }}>{t('test')}</Button>
          {authenticationFor(row).type !== 'none' && authenticationFor(row).owner === 'enterprise' &&
            <Button size="sm" variant="ghost" onClick={() => setAccountConnector(row)}>{t('connectors.accountConnect')}</Button>}
          <Switch checked={row.enabled} onChange={() => toggleEnabled(row)} label={t('status')} />
          <Button size="sm" variant="ghost" icon={<IconTrashOutlineRegular size={14} />} onClick={() => setDeleting(row)}>{t('delete')}</Button>
        </span>
      ),
    },
  ], [t, openEdit, toggleEnabled])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('connectors.title')}</h1>
          <p>{t('connectors.subtitle')}</p>
        </div>
        <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={openAdd}>
          {t('connectors.addConnector')}
        </Button>
      </header>

      <DataTable columns={columns} data={state.connectors} rowKey={row => row.id} emptyText={t('noData')} t={t} />

      <Modal
        open={form.name !== undefined}
        className={css.editorDialog ?? ''}
        onClose={closeForm}
        title={editing != null ? t('connectors.editConnector') : t('connectors.addConnector')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={closeForm}>{t('cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={saving || iconReading}>{t('save')}</Button>
          </>
        )}
      >
        <div className={css.form}>
          <label className={css.field}>
            <span>{t('connectors.icon')}</span>
            <div className={css.iconEditor}>
              <span className={css.connectorIcon}>{form.icon ? <img src={form.icon} alt="" /> : (form.name ?? '').slice(0, 1)}</span>
              <input type="file" accept="image/png,image/jpeg" disabled={saving} aria-label={t('connectors.icon')} onChange={event => {
                const chosen = event.target.files?.[0]; event.target.value = ''
                if (!chosen) return
                if (!['image/png', 'image/jpeg'].includes(chosen.type) || chosen.size > 2 * 1024 * 1024) {
                  showToast(t('connectors.iconInvalid')); return
                }
                iconReader.current?.abort()
                const reader = new FileReader(); iconReader.current = reader; setIconReading(true)
                reader.onload = () => { if (iconReader.current === reader && typeof reader.result === 'string')
                  setForm(value => ({ ...value, icon: reader.result as string })) }
                reader.onerror = () => showToast(t('connectors.iconReadFailed'))
                reader.onloadend = () => { if (iconReader.current === reader) { iconReader.current = null; setIconReading(false) } }
                reader.readAsDataURL(chosen)
              }} />
              {form.icon && <Button size="sm" variant="ghost" onClick={() => setForm(value => ({ ...value, icon: '' }))}>{t('connectors.removeIcon')}</Button>}
            </div>
          </label>
          <label className={css.field}>
            <span>{t('connectors.connectorName')}</span>
            <Input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <div className={css.toolsSection}>
            <div className={css.fieldRow}>
              <strong>{t('connectors.mallDataPermissions')}</strong>
              <Switch checked={form.mallDataPermissions === true} label={t('connectors.mallDataPermissions')}
                disabled={saving || authenticationFor(form).type !== 'none' || state.connectors.some(connector => connector.id !== editing?.id && connector.mallDataPermissions === true)}
                onChange={checked => setForm(f => ({ ...f, mallDataPermissions: checked }))} />
            </div>
            <span className={css.permissionHint}>{t(form.mallDataPermissions ? 'connectors.mallDataPermissionsOn' : 'connectors.mallDataPermissionsOff')}</span>
            <span className={css.permissionHint}>{t('connectors.mallDataPermissionsHint')}</span>
            {state.connectors.some(connector => connector.id !== editing?.id && connector.mallDataPermissions === true)
              && <span className={css.permissionHint}>{t('connectors.mallDataPermissionsAssigned')}</span>}
          </div>
          <label className={css.field}>
            <span>{t('type')}</span>
            <Input value={form.type ?? ''} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} />
          </label>
          <label className={css.field}>
            <span>{t('connectors.transport')}</span>
            <select value={form.transport ?? 'sse'} onChange={event => setForm(f => ({ ...f,
              transport: event.target.value as NonNullable<Connector['transport']>,
              authentication: { type: 'none', owner: 'enterprise', fields: [] }, employeeCredentials: 'shared' }))}>
              <option value="streamable-http">{t('connectors.streamableHttp')}</option>
              <option value="sse">{t('connectors.sse')}</option>
              <option value="stdio">{t('connectors.stdio')}</option>
            </select>
          </label>
          <ConnectorAuthenticationEditor connector={form} t={t} onChange={authentication =>
            setForm(f => ({ ...f, authentication, employeeCredentials: 'shared' }))} />
          {form.transport === 'stdio' ? <>
            <span className={css.permissionHint}>{t('connectors.stdioHint')}</span>
            <label className={css.field}>
              <span>{t('connectors.command')}</span>
              <Input value={form.command ?? ''} placeholder="npx" onChange={event => setForm(f => ({ ...f, command: event.target.value }))} />
            </label>
            <label className={css.field}>
              <span>{t('connectors.args')}</span>
              <textarea rows={4} spellCheck={false} value={argsText} onChange={event => setArgsText(event.target.value)} />
            </label>
            <label className={css.field}>
              <span>{t('connectors.env')}</span>
              <textarea rows={5} spellCheck={false} aria-label={t('connectors.env')} value={envText} onChange={event => setEnvText(event.target.value)} />
              <span className={css.muted}>{t('connectors.envHint')}</span>
            </label>
          </> : <>
          <label className={css.field}>
            <span>{t('connectors.endpoint')}</span>
            <Input value={form.endpoint ?? ''} onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))} />
          </label>
          <div className={css.toolsSection}>
            <strong>{t('connectors.headers')}</strong>
            <span className={css.muted}>{t('connectors.headersHint')}</span>
            {Object.entries(form.headers ?? {}).map(([name, value]) => <div className={css.headerRow} key={name}>
              <Input value={name} placeholder={t('connectors.headerName')} aria-label={t('connectors.headerName')}
                onChange={event => setForm(f => { const next = { ...f.headers }; delete next[name]; next[event.target.value] = value; return { ...f, headers: next } })} />
              <Input type="password" value={value} placeholder={editing?.headers && Object.hasOwn(editing.headers, name)
                ? t('connectors.keepHeaderValue') : t('connectors.headerValue')} aria-label={t('connectors.headerValue')}
                onChange={event => setForm(f => ({ ...f, headers: { ...f.headers, [name]: event.target.value } }))} />
              <Button size="sm" variant="ghost" onClick={() => setForm(f => { const next = { ...f.headers }; delete next[name]; return { ...f, headers: next } })}>{t('delete')}</Button>
            </div>)}
            <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, headers: { ...f.headers, [newHeaderName(f.headers ?? {})]: '' } }))}>{t('connectors.addHeader')}</Button>
          </div>
          </>}
          <label className={css.fieldRow}>
            <span>{t('status')}</span>
            <Switch checked={form.enabled ?? false} onChange={checked => setForm(f => ({ ...f, enabled: checked }))} label={t('status')} />
          </label>
          <div className={css.visibilitySetting}>
            <label className={css.fieldRow}>
              <span>{t('connectors.clientVisibility')}</span>
              <Switch checked={form.showToolsInClient !== false} onChange={checked => setForm(f => ({ ...f, showToolsInClient: checked }))} label={t('connectors.clientVisibility')} />
            </label>
            <span className={css.muted}>{t('connectors.clientVisibilityHint')}</span>
          </div>
          <ScopePicker scope={form.scope ?? 'all'} targets={form.scopeTarget ?? []}
            departments={state.departments} employees={state.employees} disabled={saving} t={t}
            onChange={(scope, scopeTarget) => setForm(f => ({ ...f, scope, scopeTarget }))} />
          <div className={css.toolsSection}>
            <strong>{t(form.mallDataPermissions ? 'connectors.toolPermission' : 'connectors.availableTools')}</strong>
            {!form.mallDataPermissions && <span className={css.muted}>{t('connectors.automaticToolsHint')}</span>}
            {(form.tools ?? []).length === 0
              ? <span className={css.muted}>{t(authenticationFor(form).owner === 'employee' ? 'connectors.employeeDiscoverHint' : 'connectors.discoverToolsHint')}</span>
              : <>
                {form.mallDataPermissions && <div className={css.toolActions}>
                  <Button size="sm" variant="ghost" onClick={() => setForm(f => ({ ...f, tools: (f.tools ?? []).map(tool => ({ ...tool, allowed: true })) }))}>{t('connectors.allowAll')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm(f => ({ ...f, tools: (f.tools ?? []).map(tool => ({ ...tool, allowed: false })) }))}>{t('connectors.denyAll')}</Button>
                </div>}
                {(form.tools ?? []).map(tool => <div key={tool.id} className={css.toolRow}>
                  {form.mallDataPermissions ? <Checkbox checked={tool.allowed} label={tool.name} onChange={allowed => setForm(f => ({ ...f,
                    tools: (f.tools ?? []).map(item => item.id === tool.id ? { ...item, allowed } : item),
                  }))} /> : <span>{tool.name}</span>}
                  {tool.description && <span className={css.toolDesc}>{tool.description}</span>}
                </div>)}
              </>}
          </div>
        </div>
      </Modal>

      {accountConnector && <ConnectorAccountDialog connector={accountConnector} t={t} onClose={() => {
        setAccountConnector(null)
        void loadData().then(payload => dispatch({ type: 'HYDRATE', payload })).catch(error => showToast(String(error)))
      }} onChanged={() => { void loadData().then(payload => dispatch({ type: 'HYDRATE', payload })).catch(error => showToast(String(error))) }} />}
      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={t('connectors.deleteConnector')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirmDelete}>{t('confirm')}</Button>
          </>
        )}
      >
        <p className={css.warning}>{t('models.confirmDelete', { name: deleting?.name ?? '' })}</p>
      </Modal>

      <Modal
        open={testing != null}
        onClose={() => { setTesting(null); setUnverifiedTools(null) }}
        title={t('connectors.testConnector')}
        closeLabel={t('close')}
        footer={<Button variant="primary" disabled={testingBusy} onClick={testConnector}>{t('test')}</Button>}
      >
        <p>{t('connectors.testDescription', { name: testing?.name ?? '' })}</p>
        {unverifiedTools !== null && <p className={css.discoveryNotice} role="status">
          {t('connectors.discoveredUnverified', { count: unverifiedTools })}
        </p>}
      </Modal>
    </div>
  )
}
