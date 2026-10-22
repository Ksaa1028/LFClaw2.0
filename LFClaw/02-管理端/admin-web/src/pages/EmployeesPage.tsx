import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconCopyOutlineRegular,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DataTable } from '../components/DataTable.tsx'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import type { Column } from '../components/DataTable.tsx'
import { DetailDrawer } from '../components/DetailDrawer.tsx'
import { copyText } from '../clipboard.ts'
import type { Employee } from '../mock/data.ts'

import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './EmployeesPage.module.css'
import { loadEmployeeMcpPermissions, loadEmployeePermissions, MALL_MCP_PERMISSIONS,
  resetActivationCode, saveEmployeeMcpPermissions,
  type EffectiveResource, type MallMcpPermission } from '../api.ts'

export interface EmployeesPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

export function EmployeesPage({ t, showToast }: EmployeesPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const employees = state.employees
  const departments = state.departments
  const [departmentFilter, setDepartmentFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Employee | null>(null)
  const [deleting, setDeleting] = useState<Employee | null>(null)
  const [resetting, setResetting] = useState<Employee | null>(null)
  const [detail, setDetail] = useState<Employee | null>(null)
  const [detailResources, setDetailResources] = useState<EffectiveResource[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailReload, setDetailReload] = useState(0)
  const [mcpPermissions, setMcpPermissions] = useState<MallMcpPermission[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [mcpReload, setMcpReload] = useState(0)
  const permissionGeneration = useRef(0)
  useEffect(() => () => { permissionGeneration.current++ }, [])
  const [form, setForm] = useState<Partial<Employee>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!detail) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError('')
    void loadEmployeePermissions(detail.id).then(resources => {
      if (!cancelled) setDetailResources(resources)
    }).catch((error: unknown) => {
      if (!cancelled) setDetailError(error instanceof Error ? error.message : t('employees.permissionsLoadFailed'))
    }).finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [detail, detailReload, t])

  useEffect(() => {
    if (!detail) return
    let cancelled = false
    setMcpLoading(true)
    setMcpError('')
    void loadEmployeeMcpPermissions(detail.id).then(result => {
      if (!cancelled) { setMcpPermissions(result.permissions) }
    }).catch((error: unknown) => {
      if (!cancelled) setMcpError(error instanceof Error ? error.message : t('employees.permissionsLoadFailed'))
    }).finally(() => { if (!cancelled) setMcpLoading(false) })
    return () => { cancelled = true }
  }, [detail, mcpReload, t])

  const saveMcpPermissions = useCallback(async () => {
    if (!detail || mcpSaving || mcpLoading || mcpError) return
    const generation = permissionGeneration.current
    setMcpSaving(true)
    try {
      const result = await saveEmployeeMcpPermissions(detail.id, mcpPermissions)
      if (generation !== permissionGeneration.current) return
      setMcpPermissions(result.permissions)
      showToast(t('employees.permissionSaved'), 'success')
    } catch (error) { if (generation === permissionGeneration.current) showToast(error instanceof Error ? error.message : t('employees.permissionSaveFailed')) }
    finally { if (generation === permissionGeneration.current) setMcpSaving(false) }
  }, [detail, mcpSaving, mcpLoading, mcpError, mcpPermissions, showToast, t])

  const mallPermissionLabels = useMemo(() => ({
    'operation.floor.1': t('employees.mallMcpFloor1'),
    'operation.floor.2': t('employees.mallMcpFloor2'),
    'operation.floor.3': t('employees.mallMcpFloor3'),
    'operation.floor.4': t('employees.mallMcpFloor4'),
    'operation.self_operated': t('employees.mallMcpSelfOperated'),
  }), [t])

  const authorizedResources = detailResources.filter(resource => resource.allowed)
  const mallConnector = state.connectors.find(connector => connector.mallDataPermissions === true)
  const resourceGroups = [
    { id: 'models', label: t('nav.models'), resources: authorizedResources.filter(item => item.collection === 'models') },
    { id: 'skills', label: t('nav.skills'), resources: authorizedResources.filter(item => item.collection === 'skills') },
    { id: 'connectors', label: t('nav.connectors'), resources: authorizedResources.filter(item => item.collection === 'connectors') },
    { id: 'experts', label: t('experts.singleExperts'), resources: authorizedResources.filter(item => item.collection === 'experts' && item.expertKind !== 'team') },
    { id: 'teams', label: t('experts.teams'), resources: authorizedResources.filter(item => item.collection === 'experts' && item.expertKind === 'team') },
  ]

  const filtered = useMemo(() => {
    return employees.filter(e => {
      const deptMatch = departmentFilter === '' || e.departmentId === departmentFilter
      const searchLower = search.toLowerCase()
      const searchMatch = search === '' || e.name.toLowerCase().includes(searchLower)
      return deptMatch && searchMatch
    })
  }, [employees, departmentFilter, search])

  const openAdd = useCallback(() => {
    setEditing(null)
    setForm({ name: '', status: 'active', departmentId: departments[0]?.id ?? '' })
  }, [departments])

  const openEdit = useCallback((emp: Employee) => {
    setEditing(emp)
    setForm({ ...emp })
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    const name = (form.name ?? '').trim()
    if (name === '') return
    setSaving(true)
    const payload: Employee = {
      id: editing?.id ?? 'e-' + Date.now(),
      name,
      email: form.email ?? (name.toLowerCase().replace(/\s+/g, '.') + '@lfclaw.local'),
      departmentId: form.departmentId ?? departments[0]?.id ?? '',
      status: form.status ?? 'active',
      activationCode: editing?.activationCode ?? '',
    }
    try {
      const ok = await dispatch(editing != null ? { type: 'UPDATE_EMPLOYEE', payload } : { type: 'ADD_EMPLOYEE', payload })
      if (ok) { showToast(t('save'), 'success'); setEditing(null); setForm({}) }
    } finally { setSaving(false) }
  }, [saving, editing, form, departments, dispatch, showToast, t])

  const confirmResetCode = useCallback(async () => {
    if (resetting == null) return
    try {
      const activationCode = await resetActivationCode(resetting.id)
      const updated = { ...resetting, activationCode }
      if (await dispatch({ type: 'SET_EMPLOYEES', payload: employees.map(item => item.id === updated.id ? updated : item) })) {
        showToast(t('employees.activationCodeReset'), 'success')
        setResetting(null)
      }
    } catch (error) { showToast(error instanceof Error ? error.message : '重置失败') }
  }, [resetting, employees, dispatch, showToast, t])

  const copyCode = useCallback(async (code: string) => {
    const copied = await copyText(code)
    showToast(t(copied ? 'employees.codeCopied' : 'employees.codeCopyFailed'), copied ? 'success' : undefined)
  }, [showToast, t])

  const confirmDelete = useCallback(async () => {
    if (deleting == null) return
    if (await dispatch({ type: 'DELETE_EMPLOYEE', payload: deleting.id })) { showToast(t('delete'), 'success'); setDeleting(null) }
  }, [deleting, dispatch, showToast, t])

  const getDepartmentName = useCallback((departmentId: string): string => {
    const dept = departments.find(d => d.id === departmentId)
    return dept?.name ?? departmentId
  }, [departments])

  const columns: Column<Employee>[] = useMemo(() => [
    { key: 'name', title: t('employees.employeeName'), render: row => row.name },
    { key: 'department', title: t('employees.department'), render: row => getDepartmentName(row.departmentId) },
    {
      key: 'status',
      title: t('status'),
      render: row => <Tag tone={row.status === 'active' ? 'success' : 'danger'}>{row.status === 'active' ? t('active') : t('inactive')}</Tag>,
    },
    {
      key: 'activationCode',
      title: t('employees.activationCode'),
      render: row => (
        <span className={css.codeCell}>
          <code style={{ fontFamily: 'monospace', fontSize: '13px', letterSpacing: '0.5px' }}>{row.activationCode}</code>
          <Button size="sm" variant="ghost" icon={<IconCopyOutlineRegular size={14} />} onClick={() => copyCode(row.activationCode)}>
            {t('copy')}
          </Button>
        </span>
      ),
    },
    {
      key: 'actions',
      title: t('actions'),
      width: '400px',
      render: row => (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { permissionGeneration.current++; setMcpPermissions([]); setMcpLoading(true); setMcpSaving(false); setMcpError(''); setDetailResources([]); setDetail(row) }}
          >
            {t('employees.viewDetail')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEdit(row)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px', whiteSpace: 'nowrap' }}
          >
            <IconEditOutlineRegular size={14} />
            <span>{t('edit')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResetting(row)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px', whiteSpace: 'nowrap' }}
          >
            <IconRefreshOutlineRegular size={14} />
            <span>{t('employees.resetCode')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeleting(row)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px', whiteSpace: 'nowrap', color: '#dc2626', borderColor: '#fecaca' }}
          >
            <IconTrashOutlineRegular size={14} />
            <span>{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ], [t, openEdit, copyCode, getDepartmentName])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('employees.title')}</h1>
          <p>{t('employees.subtitle')}</p>
        </div>
        <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={openAdd}>
          {t('employees.addEmployee')}
        </Button>
      </header>

      <div className={css.filters}>
        <select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
          <option value="">{t('employees.departmentFilter')}</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <Input
          icon={<IconSearchOutlineRegular size={16} />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('employees.nameOrEmail')}
        />
      </div>

      <DataTable columns={columns} data={filtered} rowKey={row => row.id} emptyText={t('noData')} t={t} />

      <Modal
        open={form.name !== undefined}
        onClose={() => { if (!saving) { setEditing(null); setForm({}) } }}
        title={editing != null ? t('employees.editEmployee') : t('employees.addEmployee')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { if (!saving) { setEditing(null); setForm({}) } }} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? '保存中...' : t('save')}</Button>
          </>
        )}
      >
        <div className={css.form}>
          <label className={css.field}>
            <span>{t('employees.employeeName')}</span>
            <Input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={saving} />
          </label>
          <label className={css.field}>
            <span>{t('employees.department')}</span>
            <select value={form.departmentId ?? ''} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))} disabled={saving}>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className={css.fieldRow}>
            <span>{t('status')}</span>
            <Switch
              checked={form.status === 'active'}
              onChange={checked => setForm(f => ({ ...f, status: checked ? 'active' : 'inactive' }))}
              label={t('status')}
              disabled={saving}
            />
          </label>
          {editing != null && (
            <label className={css.fieldRow}>
              <span>{t('employees.activationCode')}</span>
              <code style={{ fontFamily: 'monospace' }}>{editing.activationCode}</code>
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={resetting != null}
        onClose={() => setResetting(null)}
        title={t('employees.resetCode')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setResetting(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirmResetCode}>{t('confirm')}</Button>
          </>
        )}
      >
        <p className={css.warning}>{t('employees.confirmResetCode', { name: resetting?.name ?? '' })}</p>
      </Modal>

      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={t('employees.deleteEmployee')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirmDelete}>{t('confirm')}</Button>
          </>
        )}
      >
        <p className={css.warning}>{t('employees.confirmDelete', { name: deleting?.name ?? '' })}</p>
      </Modal>

      <DetailDrawer
        title={t('employees.detailTitle')}
        closeLabel={t('close')}
        open={detail != null}
        onClose={() => { permissionGeneration.current++; setDetail(null) }}
      >
        {detail != null && (
          <div className={css.detailBody}>
            <section>
              <h3>{t('employees.basicInfo')}</h3>
              <div className={css.detailGrid}>
                <span><small>{t('employees.employeeName')}</small><strong>{detail.name}</strong></span>
                <span><small>{t('employees.department')}</small><strong>{getDepartmentName(detail.departmentId)}</strong></span>
                <span><small>{t('status')}</small><Tag tone={detail.status === 'active' ? 'success' : 'danger'}>{detail.status === 'active' ? t('active') : t('inactive')}</Tag></span>
              </div>
            </section>
            <section>
              <h3>{t('employees.permissions')}</h3>
              {detailLoading && <p className={css.muted}>{t('employees.permissionsLoading')}</p>}
              {detailError && <p className={css.muted}>{detailError} <Button size="sm" variant="ghost" onClick={() => setDetailReload(value => value + 1)}>{t('employees.retryPermissions')}</Button></p>}
              {!detailLoading && !detailError && resourceGroups.map(group => <div className={css.resourceGroup} key={group.id}>
                <h4>{group.label} · {group.resources.length}</h4>
                {group.resources.length === 0 && <p className={css.muted}>{t('employees.noAuthorizedResources')}</p>}
                <ul className={css.resourceList}>
                {group.resources.map(res => (
                  <li key={`${res.collection}:${res.id}`}>
                    <span className={css.resourceName}>{res.name}</span>
                    <Tag tone="success">{t('employees.authorized')}</Tag>
                  </li>
                ))}
                </ul>
              </div>)}
            </section>
            {mallConnector && <section>
              <h3>{mallConnector.name} · {t('employees.mallMcpTitle')}</h3>
              <p className={css.muted}>{t('employees.mallMcpHint')}</p>
              {mcpLoading && <p className={css.muted}>{t('employees.permissionsLoading')}</p>}
              {mcpError && <p className={css.muted}>{mcpError} <Button size="sm" variant="ghost" onClick={() => setMcpReload(value => value + 1)}>{t('employees.retryPermissions')}</Button></p>}
              {!mcpLoading && !mcpError && <div className={css.mcpSettings}>
                <div className={css.mcpPermissions}>
                  {MALL_MCP_PERMISSIONS.map(permission => <label key={permission} className={css.mcpChoice}>
                    <input type="checkbox" checked={mcpPermissions.includes(permission)}
                      disabled={mcpSaving}
                      onChange={event => setMcpPermissions(current => event.target.checked
                        ? [...current, permission] : current.filter(item => item !== permission))} />
                    {mallPermissionLabels[permission]}
                  </label>)}
                </div>
                {mcpPermissions.length === 0 && <p className={css.muted}>{t('employees.mallMcpEmpty')}</p>}
                <Button size="sm" variant="primary" onClick={() => void saveMcpPermissions()} disabled={mcpSaving}>
                  {t('employees.mallMcpSave')}
                </Button>
              </div>}
            </section>}
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
