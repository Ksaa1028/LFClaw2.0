import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconEditOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatDate, type Skill } from '../mock/data.ts'
import { ScopePicker } from '../components/ScopePicker.tsx'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './SkillsPage.module.css'
import { Pagination, usePaginatedData } from '../components/Pagination.tsx'
import { loadData, loadSkillVersions, rollbackSkill, uploadSkill, type SkillVersions, request } from '../api.ts'

export interface SkillsPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

function SkillIcon({ icon, name, size = 48 }: { icon?: string; name: string; size?: number }) {
  if (icon && icon.startsWith('data:')) {
    return <img src={icon} alt={name} style={{ width: size, height: size, borderRadius: 12, objectFit: 'cover' }} />
  }
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{
      width: size, height: size, borderRadius: 12,
      background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.5, flexShrink: 0,
    }}>
      {name.slice(0, 1)}
    </div>
  )
}

export function SkillsPage({ t, showToast }: SkillsPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const [personalOpen, setPersonalOpen] = useState(false)
  const [personalReports, setPersonalReports] = useState<{ id: string; employeeName: string; deviceId: string; updatedAt: string; skills: { name: string; description: string; version: string; enabled: boolean; source: string }[] }[] | null>(null)
  const [personalError, setPersonalError] = useState('')
  const [personalReload, setPersonalReload] = useState(0)
  useEffect(() => {
    if (!personalOpen) return
    let cancelled = false
    setPersonalError(''); setPersonalReports(null)
    void request<NonNullable<typeof personalReports>>('/admin/personal-skills').then(items => { if (!cancelled) setPersonalReports(items) })
      .catch((error: unknown) => { if (!cancelled) setPersonalError(error instanceof Error ? error.message : '读取失败，请重试') })
    return () => { cancelled = true }
  }, [personalOpen, personalReload])
  const [editing, setEditing] = useState<Skill | null>(null)
  const [deleting, setDeleting] = useState<Skill | null>(null)
  const [form, setForm] = useState<Partial<Skill>>({})
  const [saving, setSaving] = useState(false)
  const [versionSkill, setVersionSkill] = useState<Skill | null>(null)
  const [versionHistory, setVersionHistory] = useState<SkillVersions | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionError, setVersionError] = useState('')
  const [versionReload, setVersionReload] = useState(0)
  const [rollingBack, setRollingBack] = useState(false)
  const [zipFile, setZipFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iconReader = useRef<FileReader | null>(null)
  const [iconReading, setIconReading] = useState(false)
  useEffect(() => () => { iconReader.current?.abort() }, [])

  const enterpriseSkills = useMemo(() => state.skills.filter(s => s.source === 'enterprise'), [state.skills])
  const skills = usePaginatedData(enterpriseSkills)
  const reports = usePaginatedData(personalReports ?? [], personalOpen ? String(personalReload) : 'closed')
  const versions = usePaginatedData(versionHistory?.versions ?? [], versionSkill?.id)

  useEffect(() => {
    if (!versionSkill) return
    let cancelled = false
    setVersionLoading(true)
    setVersionError('')
    void loadSkillVersions(versionSkill.id).then(result => {
      if (!cancelled) setVersionHistory(result)
    }).catch((error: unknown) => {
      if (!cancelled) setVersionError(error instanceof Error ? error.message : t('skills.historyUnavailable'))
    }).finally(() => { if (!cancelled) setVersionLoading(false) })
    return () => { cancelled = true }
  }, [versionSkill, versionReload, t])

  const restoreVersion = useCallback(async (revision: number, version: string) => {
    if (!versionSkill || rollingBack || !window.confirm(t('skills.confirmRollback', { version }))) return
    setRollingBack(true)
    try {
      await rollbackSkill(versionSkill.id, revision)
      await dispatch({ type: 'HYDRATE', payload: await loadData() })
      setVersionReload(current => current + 1)
      showToast(t('skills.rollbackDone'), 'success')
    } catch (error) { showToast(error instanceof Error ? error.message : t('skills.historyUnavailable')) }
    finally { setRollingBack(false) }
  }, [versionSkill, rollingBack, dispatch, showToast, t])

  const openAdd = useCallback(() => {
    iconReader.current?.abort(); iconReader.current = null; setIconReading(false)
    setEditing(null)
    setZipFile(null)
    setForm({ name: '', version: '1.0.0', description: '', enabled: true, source: 'enterprise', scope: 'all', scopeTarget: [], parsingStatus: 'pending' })
  }, [])

  const openEdit = useCallback((skill: Skill) => {
    iconReader.current?.abort(); iconReader.current = null; setIconReading(false)
    setEditing(skill)
    setZipFile(null)
    setForm({ ...skill })
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    const name = (form.name ?? '').trim()
    if (name === '') return
    if (!(form.version ?? '').trim()) { showToast('请填写技能版本'); return }
    setSaving(true)

    let zipPath = editing?.zipPath ?? ''
    let description = editing?.description ?? ''
    try {
      if (zipFile) {
        const uploaded = await uploadSkill(zipFile)
        zipPath = uploaded.path
        description = uploaded.description
      }
      if (!zipPath) { showToast('请先上传包含 SKILL.md 的 ZIP 文件'); setSaving(false); return }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'ZIP 上传失败')
      setSaving(false)
      return
    }

    const payload: Skill = {
      id: editing?.id ?? 's-' + Date.now(),
      name,
      version: (form.version ?? '').trim() || '1.0.0',
      description,
      enabled: form.enabled ?? false,
      source: 'enterprise',
      parsingStatus: zipFile ? 'success' : (form.parsingStatus ?? 'pending'),
      scope: form.scope ?? 'all',
      scopeTarget: (form.scope === 'all' || form.scope === 'none') ? [] : form.scopeTarget ?? [],
      zipPath,
      icon: form.icon ?? '',
    }
    try {
      const ok = await dispatch(editing != null ? { type: 'UPDATE_SKILL', payload } : { type: 'ADD_SKILL', payload })
      if (ok) {
        showToast(t('save'), 'success')
        setEditing(null)
        setForm({})
        setZipFile(null)
      }
    } finally { setSaving(false) }
  }, [saving, editing, form, zipFile, dispatch, showToast, t])

  const confirmDelete = useCallback(async () => {
    if (deleting == null) return
    if (await dispatch({ type: 'DELETE_SKILL', payload: deleting.id })) { showToast(t('delete'), 'success'); setDeleting(null) }
  }, [deleting, dispatch, showToast, t])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('skills.title')}</h1>
          <p>{t('skills.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}><Button variant="outline" onClick={() => setPersonalOpen(true)}>{t('skills.personalSkills')}</Button>
        <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={openAdd}>{t('add')}</Button></div>
      </header>

      {enterpriseSkills.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}></div>
          <div style={{ fontSize: 16 }}>暂无企业技能</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>点击"新增"添加技能</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, padding: '0 0 20px' }}>
          {skills.items.map(skill => (
            <div key={skill.id} style={{
              background: '#fff', borderRadius: 12, padding: 20,
              border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <SkillIcon {...(skill.icon ? { icon: skill.icon } : {})} name={skill.name} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{skill.name}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, padding: '1px 6px', background: '#f3f4f6', borderRadius: 4, color: '#666' }}>v{skill.version}</span>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, color: skill.enabled ? '#16a34a' : '#dc2626', background: skill.enabled ? '#f0fdf4' : '#fef2f2' }}>
                      {skill.enabled ? '启用' : '停用'}
                    </span>
                  </div>
                </div>
              </div>
              {skill.description && (
                <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {skill.description}
                </div>
              )}
              <div style={{ fontSize: 12, color: '#666' }}>{t('models.scope')}：{skill.scope === 'none' ? t('distribution.none') : skill.scope === 'department' || skill.scope === 'employee'
                ? `${skill.scope === 'department' ? t('distribution.departments') : t('distribution.employees')} · ${skill.scopeTarget?.length ?? 0}`
                : t('distribution.all')}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
                <Button size="sm" variant="outline" onClick={() => { setVersionHistory(null); setVersionSkill(skill) }}>
                  {t('skills.versionHistory')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(skill)}
                  style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 0' }}>
                  <IconEditOutlineRegular size={14} /><span>编辑</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeleting(skill)}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 12px', color: '#dc2626', borderColor: '#fecaca' }}>
                  <IconTrashOutlineRegular size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={skills.page} total={skills.total} onPageChange={skills.setPage} t={t} />

      <Modal open={personalOpen} onClose={() => setPersonalOpen(false)} title={t('skills.personalSkills')} closeLabel={t('close')}
        footer={<Button variant="outline" onClick={() => setPersonalReload(value => value + 1)}>刷新清单</Button>}>
        <p>仅展示员工设备上报的元数据，不包含技能正文和附件。设备离线时可能不是最新状态。</p>
        {personalError && <p role="alert">{personalError}</p>}
        {!personalReports && !personalError && <p>{t('loading')}</p>}
        {personalReports?.length === 0 && <p>暂无员工设备上报的技能清单</p>}
        {reports.items.map(report => <section key={report.id}>
          <h3>{report.employeeName}</h3><p>设备 {report.deviceId.slice(0, 8)} · 上报时间 {new Date(report.updatedAt).toLocaleString()}</p>
          {report.skills.length === 0 ? <p>该设备暂无个人技能</p> : report.skills.map(skill => <div key={skill.name} style={{ borderTop: '1px solid var(--dsw-alias-border-l3)', padding: '12px 0' }}>
            <strong>{skill.name}</strong><p>{skill.description}</p><span>版本 {skill.version} · 个人技能 · {skill.enabled ? '启用' : '停用'}</span>
          </div>)}
        </section>)}
        <Pagination page={reports.page} total={reports.total} onPageChange={reports.setPage} t={t} />
      </Modal>

      <Modal open={form.name !== undefined}
        onClose={() => { if (!saving) { iconReader.current?.abort(); iconReader.current = null; setIconReading(false); setEditing(null); setForm({}); setZipFile(null) } }}
        title={editing != null ? '编辑技能' : '新增技能'}
        closeLabel={t('close')}
        footer={(<>
          <Button variant="ghost" onClick={() => { if (!saving) { iconReader.current?.abort(); iconReader.current = null; setIconReading(false); setEditing(null); setForm({}); setZipFile(null) } }} disabled={saving}>{t('cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={saving || iconReading}>{saving ? '保存中...' : t('save')}</Button>
        </>)}>
        <div className={css.form}>
          <label className={css.field}>
            <span>技能图标</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SkillIcon {...(form.icon ? { icon: form.icon } : {})} name={form.name || 'S'} />
              <input type="file" accept="image/png,image/jpeg" disabled={saving} aria-label="上传技能图标" onChange={event => {
                const chosen = event.target.files?.[0]; event.target.value = ''
                if (!chosen) return
                if (!['image/png', 'image/jpeg'].includes(chosen.type) || chosen.size > 2 * 1024 * 1024) { showToast('请选择 2MB 以内的 PNG 或 JPG 图标'); return }
                iconReader.current?.abort()
                const reader = new FileReader(); iconReader.current = reader; setIconReading(true)
                reader.onload = () => { if (iconReader.current !== reader) return; const icon = reader.result; if (typeof icon === 'string') setForm(value => ({ ...value, icon })) }
                reader.onerror = () => showToast('图标读取失败，请重新选择')
                reader.onloadend = () => { if (iconReader.current === reader) { iconReader.current = null; setIconReading(false) } }
                reader.readAsDataURL(chosen)
              }} />
              {form.icon && <Button variant="outline" size="sm" disabled={saving} onClick={() => setForm(value => ({ ...value, icon: '' }))}>移除图标</Button>}
            </div>
          </label>
          <label className={css.field}><span>{t('skills.version')}</span><Input value={form.version ?? '1.0.0'} maxLength={64} disabled={saving} onChange={event => setForm(value => ({ ...value, version: event.target.value }))} /></label>
          <label className={css.field}>
            <span>技能名称</span>
            <Input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={saving} placeholder="例如：数据报表助手" />
          </label>
            <label className={css.field}>
              <span>技能包 ZIP</span>
              <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) { setZipFile(file); e.target.value = '' }
                }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  {zipFile ? '更换 ZIP' : '上传 ZIP 包'}
                </Button>
                {zipFile && <span style={{ fontSize: 13, color: '#666' }}>{zipFile.name} ({(zipFile.size / 1024).toFixed(1)} KB)</span>}
                {zipFile && <Button size="sm" variant="ghost" onClick={() => setZipFile(null)}>移除</Button>}
              </div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>描述自动读取 ZIP 内 SKILL.md 的 description</div>
            </label>
          <ScopePicker scope={form.scope ?? 'all'} targets={form.scopeTarget ?? []}
            departments={state.departments} employees={state.employees} disabled={saving} t={t}
            onChange={(scope, scopeTarget) => setForm(f => ({ ...f, scope, scopeTarget }))} />

          {<label className={css.fieldRow}>
            <span>{t('status')}</span>
            <Switch checked={form.enabled ?? false} onChange={checked => setForm(f => ({ ...f, enabled: checked }))} label={t('status')} disabled={saving} />
          </label>}
        </div>
      </Modal>

      <Modal open={deleting != null} onClose={() => setDeleting(null)} title="删除技能" closeLabel={t('close')}
        footer={(<>
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t('cancel')}</Button>
          <Button variant="primary" onClick={confirmDelete}>{t('confirm')}</Button>
        </>)}>
        <p className={css.warning}>确定删除技能「{deleting?.name}」吗？此操作不可撤销。</p>
      </Modal>

      <Modal open={versionSkill != null} onClose={() => { if (!rollingBack) setVersionSkill(null) }}
        title={t('skills.versionHistory')} closeLabel={t('close')}>
        {versionLoading && <p>{t('employees.permissionsLoading')}</p>}
        {versionError && <p>{versionError} <Button size="sm" variant="ghost" onClick={() => setVersionReload(value => value + 1)}>{t('employees.retryPermissions')}</Button></p>}
        {!versionLoading && !versionError && <div className={css.versions}>
          {versions.items.map(entry => <div className={css.versionRow} key={entry.revision}>
            <div className={css.versionDetails}>
              <strong>v{entry.version}</strong>
              <span>{formatDate(entry.createdAt)}</span>
              <span>{entry.description}</span>
              {entry.restoredFromRevision && <span>{t('skills.restoredFrom', { revision: entry.restoredFromRevision })}</span>}
            </div>
            {entry.revision === versionHistory?.currentRevision
              ? <span>{t('skills.currentVersion')}</span>
              : <Button size="sm" variant="outline" disabled={rollingBack}
                onClick={() => void restoreVersion(entry.revision, entry.version)}>{t('skills.rollback')}</Button>}
          </div>)}
          <Pagination page={versions.page} total={versions.total} onPageChange={versions.setPage} t={t} />
        </div>}
      </Modal>
    </div>
  )
}
