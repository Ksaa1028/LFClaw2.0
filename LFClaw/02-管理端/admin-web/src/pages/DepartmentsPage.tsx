import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DataTable } from '../components/DataTable.tsx'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import type { Column } from '../components/DataTable.tsx'
import type { Department } from '../mock/data.ts'
import { getDepartmentChildren } from '../mock/data.ts'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './DepartmentsPage.module.css'

export interface DepartmentsPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

interface FlatNode extends Department {
  depth: number
  expanded: boolean
  hasChildren: boolean
}

function makeInitialExpanded(departments: Department[]): Record<string, boolean> {
  const record: Record<string, boolean> = {}
  departments.forEach(d => { record[d.id] = true })
  return record
}

export function DepartmentsPage({ t, showToast }: DepartmentsPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const departments = state.departments
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => makeInitialExpanded(departments))
  const [editing, setEditing] = useState<Department | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)
  const [form, setForm] = useState<Partial<Department>>({})
  const [saving, setSaving] = useState(false)

  const flatNodes = useMemo<FlatNode[]>(() => {
    const result: FlatNode[] = []
    const walk = (parentId: string | null, depth: number): void => {
      getDepartmentChildren(parentId, departments).forEach(dept => {
        const hasChildren = getDepartmentChildren(dept.id, departments).length > 0
        result.push({ ...dept, depth, expanded: expanded[dept.id] ?? false, hasChildren })
        if ((expanded[dept.id] ?? false) && hasChildren) {
          walk(dept.id, depth + 1)
        }
      })
    }
    walk(null, 0)
    return result
  }, [departments, expanded])

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const openAdd = useCallback((parentId: string | null = null) => {
    setEditing(null)
    setForm({ name: '', parentId })
  }, [])

  const openEdit = useCallback((dept: Department) => {
    setEditing(dept)
    setForm({ name: dept.name, parentId: dept.parentId })
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    const name = (form.name ?? '').trim()
    if (name === '') return
    setSaving(true)
    const payload: Department = {
      id: editing?.id ?? 'd-' + Date.now(),
      name,
      code: name,
      parentId: form.parentId ?? null,
    }
    try {
      const ok = await dispatch(editing != null ? { type: 'UPDATE_DEPARTMENT', payload } : { type: 'ADD_DEPARTMENT', payload })
      if (ok) { showToast(t('save'), 'success'); setEditing(null); setForm({}) }
    } finally { setSaving(false) }
  }, [saving, editing, form, dispatch, showToast, t])

  const confirmDelete = useCallback(async () => {
    if (deleting == null) return
    const idsToRemove = new Set<string>([deleting.id])
    const collect = (parentId: string): void => {
      departments.filter(d => d.parentId === parentId).forEach(d => {
        idsToRemove.add(d.id)
        collect(d.id)
      })
    }
    collect(deleting.id)
    for (const id of idsToRemove) {
      if (!await dispatch({ type: 'DELETE_DEPARTMENT', payload: id })) return
    }
    showToast(t('delete'), 'success')
    setDeleting(null)
  }, [deleting, departments, dispatch, showToast, t])

  const columns: Column<FlatNode>[] = useMemo(() => [
    {
      key: 'name',
      title: t('departments.departmentName'),
      render: row => (
        <span className={css.treeCell} style={{ paddingLeft: row.depth * 20 + 'px' }}>
          {row.hasChildren && (
            <button
              type="button"
              className={css.expandButton}
              onClick={() => toggleExpand(row.id)}
              aria-label={row.expanded ? t('departments.collapse') : t('departments.expand')}
            >
              {row.expanded ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
            </button>
          )}
          <span>{row.name}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      title: t('actions'),
      width: '200px',
      render: row => (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEdit(row)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px' }}
          >
            <IconEditOutlineRegular size={14} />
            <span>{t('edit')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeleting(row)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', color: '#dc2626' }}
          >
            <IconTrashOutlineRegular size={14} />
            <span>{t('delete')}</span>
          </Button>
        </div>
      ),
    },
  ], [t, toggleExpand, openEdit])

  const parentOptions = useMemo(() => {
    return departments.filter(d => d.id !== editing?.id)
  }, [departments, editing])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('departments.title')}</h1>
          <p>{t('departments.subtitle')}</p>
        </div>
        <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={() => openAdd(null)}>
          {t('departments.addDepartment')}
        </Button>
      </header>

      <DataTable columns={columns} data={flatNodes} rowKey={row => row.id} emptyText={t('noData')} t={t} />

      <Modal
        open={form.name !== undefined}
        onClose={() => { if (!saving) { setEditing(null); setForm({}) } }}
        title={editing != null ? t('departments.editDepartment') : t('departments.addDepartment')}
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
            <span>{t('departments.departmentName')}</span>
            <Input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={saving} />
          </label>
          <label className={css.field}>
            <span>{t('departments.parentDepartment')}</span>
            <select
              value={form.parentId ?? ''}
              onChange={e => setForm(f => ({ ...f, parentId: e.target.value || null }))}
              disabled={saving}
            >
              <option value="">{t('departments.root')}</option>
              {parentOptions.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={t('departments.deleteDepartment')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={confirmDelete}>{t('confirm')}</Button>
          </>
        )}
      >
        <p className={css.warning}>{t('departments.confirmDelete', { name: deleting?.name ?? '' })}</p>
      </Modal>
    </div>
  )
}
