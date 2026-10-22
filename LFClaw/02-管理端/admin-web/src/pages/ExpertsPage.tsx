import { useCallback, useState, type ReactNode } from 'react'
import {
  Button,
  IconEditOutlineRegular,
  IconAgentPresetOutlineRegular,
  IconPlusOutlineRegular,
  IconPlayOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import { ScopePicker } from '../components/ScopePicker.tsx'
import type { Expert } from '../mock/data.ts'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import { ApiError, testExpert, request, loadData } from '../api.ts'
import { ExpertParameterImport, type ExpertImportPreview } from './ExpertParameterImport.tsx'
import css from './ExpertsPage.module.css'
import { Pagination, usePaginatedData } from '../components/Pagination.tsx'

export interface ExpertsPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

export function ExpertsPage({ t, showToast }: ExpertsPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const [editing, setEditing] = useState<Expert | null>(null)
  const [deleting, setDeleting] = useState<Expert | null>(null)
  const [form, setForm] = useState<Partial<Expert>>({})
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState('')
  const [search, setSearch] = useState('')
  const [importText, setImportText] = useState('')
  const [difyInputsText, setDifyInputsText] = useState('{}')
  const [importPreview, setImportPreview] = useState<ExpertImportPreview | null>(null)
  const nativeImport = form.source === 'dsh'
  const filteredExperts = state.experts.filter(item => item.source !== 'team'
    && [item.name, item.description, ...item.tags].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const experts = usePaginatedData(filteredExperts, search)

  const openAdd = useCallback(() => {
    setImportText(''); setImportPreview(null)
    setDifyInputsText('{}')
    setEditing(null)
    setForm({ name: '', description: '', tags: [], enabled: false, source: 'dsh', instructions: '',
      externalConfig: { appId: '', workspaceId: '', apiKey: '' }, scope: 'all', scopeTarget: [] })
  }, [])

  const openEdit = useCallback((expert: Expert) => {
    setImportPreview(null)
    setDifyInputsText(JSON.stringify(expert.externalConfig?.inputs ?? {}, null, 2))
    setImportText(JSON.stringify({ ...expert, source: expert.source === 'dsh' ? 'original' : expert.source, kind: 'expert' }, null, 2))
    setEditing(expert)
    setForm({ ...expert })
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    if (nativeImport) {
      if (!importPreview) { showToast(t('experts.validateFirst')); return }
      setSaving(true)
      try {
        await request('/admin/experts/import', { method: 'POST', body: JSON.stringify({ definition: JSON.parse(importText), preview: false,
          ...(editing ? { targetId: editing.id } : {}), scope: form.scope, scopeTarget: form.scopeTarget, enabled: form.enabled }) })
        setForm({}); setEditing(null); showToast(t('save'), 'success')
        try { await dispatch({ type: 'HYDRATE', payload: await loadData() }) }
        catch (error) { showToast(t('experts.savedRefreshFailed')) }
      } catch (error) { showToast(error instanceof Error ? error.message : t('experts.importInvalid')) }
      finally { setSaving(false) }
      return
    }
    const name = (form.name ?? '').trim()
    if (name === '') return
    if (form.source === 'bailian' && (!form.externalConfig?.appId?.trim()
      || (!form.externalConfig.apiKey && !(editing?.source === form.source && editing.hasApiKey)))) { showToast(t('experts.testFailed')); return }
    if (form.source === 'dify' && (!form.externalConfig?.apiUrl?.trim()
      || (!form.externalConfig.apiKey && !(editing?.source === form.source && editing.hasApiKey)))) { showToast(t('experts.testFailed')); return }
    if (form.source === 'weknora' && (!form.externalConfig?.apiUrl?.trim() || !form.externalConfig.agentId?.trim()
      || (!form.externalConfig.apiKey && !(editing?.source === form.source && editing.hasApiKey)))) { showToast(t('experts.weknoraRequired')); return }
    if (form.source === 'weknora') {
      try {
        const url = new URL(form.externalConfig?.apiUrl ?? '')
        if (!(url.protocol === 'https:' || url.protocol === 'http:')
          || !!url.username || !!url.password || !!url.search || !!url.hash
          || !url.pathname.replace(/\/$/u, '').endsWith('/api/v1')) throw new Error('invalid WeKnora URL')
      } catch { showToast(t('experts.weknoraUrlInvalid')); return }
    }
    let difyInputs: Record<string, unknown> = {}
    if (form.source === 'dify') {
      try {
        const value: unknown = JSON.parse(difyInputsText || '{}')
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid inputs')
        difyInputs = value as Record<string, unknown>
      } catch { showToast(t('experts.difyInputsInvalid')); return }
    }
    if (form.source === 'dsh' && !form.instructions?.trim()) {
      showToast(t('experts.instructions')); return
    }
    setSaving(true)
    const payload: Expert = {
      id: editing?.id ?? 'x-' + Date.now(),
      name,
      description: (form.description ?? '').trim(),
      ...(form.source === 'dsh' ? { instructions: (form.instructions ?? '').trim() } : {}),
      enabled: form.enabled ?? false,
      tags: form.tags ?? [],
      skillIds: [], connectorIds: [],
      quickPrompts: [],
      source: form.source ?? 'dsh',
      externalConfig: form.source === 'dsh' ? undefined : form.source === 'dify'
        ? { apiUrl: form.externalConfig?.apiUrl ?? '', apiKey: form.externalConfig?.apiKey ?? '', inputs: difyInputs }
        : form.source === 'weknora'
          ? { apiUrl: form.externalConfig?.apiUrl ?? '', agentId: form.externalConfig?.agentId ?? '',
            apiKey: form.externalConfig?.apiKey ?? '' }
          : form.source === 'bailian'
            ? { appId: form.externalConfig?.appId ?? '', workspaceId: form.externalConfig?.workspaceId ?? '', apiKey: form.externalConfig?.apiKey ?? '' }
            : form.externalConfig,
      scope: form.scope ?? 'all',
      scopeTarget: (form.scope === 'all' || form.scope === 'none') ? [] : form.scopeTarget ?? [],
    }
    try {
      const ok = await dispatch(editing != null ? { type: 'UPDATE_EXPERT', payload } : { type: 'ADD_EXPERT', payload })
      if (ok) { showToast(t('save'), 'success'); setEditing(null); setForm({}) }
    } finally { setSaving(false) }
  }, [saving, editing, form, dispatch, showToast, t, nativeImport, importPreview, importText, difyInputsText])

  const runTest = useCallback(async (expert: Expert) => {
    if (testingId) return
    setTestingId(expert.id)
    try {
      const result = await testExpert(expert.id)
      showToast(t('experts.testSuccess', { text: result.text.slice(0, 100) }), 'success')
    } catch (error) { showToast(error instanceof Error ? error.message : t('experts.testFailed')) }
    finally { setTestingId('') }
  }, [testingId, showToast, t])

  const confirmDelete = useCallback(async () => {
    if (deleting == null) return
    if (await dispatch({ type: 'DELETE_EXPERT', payload: deleting.id })) { showToast(t('delete'), 'success'); setDeleting(null) }
  }, [deleting, dispatch, showToast, t])

  const toggleEnabled = useCallback(async (expert: Expert) => {
    const updated = { ...expert, enabled: !expert.enabled }
    await dispatch({ type: 'UPDATE_EXPERT', payload: updated })
  }, [dispatch])


  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('experts.title')}</h1>
          <p>{t('experts.subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <Button variant="outline" onClick={() => { setEditing(null); setDifyInputsText('{}'); setForm({ name: '', description: '', tags: [], enabled: false,
            source: 'bailian', externalConfig: { appId: '', workspaceId: '', apiKey: '' }, scope: 'all', scopeTarget: [] }) }}>{t('experts.addExternal')}</Button>
          <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={openAdd}>
            {t('experts.importOriginal')}
          </Button>
        </div>
      </header>
      <Input className={css.search ?? ''} value={search} placeholder={t('experts.search')} aria-label={t('experts.search')}
        onChange={event => setSearch(event.target.value)} />
      <div className={css.grid}>
        {experts.items.map(item => <article className={css.card} key={item.id}>
          <div className={css.cardHeader}><span className={css.expertIcon}><IconAgentPresetOutlineRegular size={28} /></span>
            <div className={css.cardIdentity}><h2>{item.name}</h2><div className={css.tags}>
              <Tag tone={item.enabled ? 'success' : 'danger'}>{t(item.enabled ? 'enabled' : 'disabled')}</Tag>
              <Tag tone="info">{item.source === 'dsh'
                ? t('experts.sourceDsh') : item.source === 'bailian' ? t('experts.sourceBailian')
                  : item.source === 'dify' ? t('experts.sourceDify')
                    : item.source === 'weknora' ? t('experts.sourceWeKnora') : t('experts.sourceExternal')}</Tag>
            </div></div></div>
          <p className={css.summary}>{item.description}</p>
          <p className={css.scope}>{t('models.scope')}：{item.scope === 'none' ? t('distribution.none') : item.scope === 'department' || item.scope === 'employee'
            ? `${item.scope === 'department' ? t('distribution.departments') : t('distribution.employees')} · ${item.scopeTarget.length}`
            : t('distribution.all')}</p>
          <div className={css.cardActions}>
            <Button size="sm" variant="outline" icon={<IconEditOutlineRegular size={14} />} onClick={() => openEdit(item)}>{t('edit')}</Button>
            {(item.source === 'bailian' || item.source === 'dify' || item.source === 'weknora') && <Button size="sm" variant="outline" disabled={testingId !== ''}
              icon={<IconPlayOutlineRegular size={14} />} onClick={() => void runTest(item)}>{t('experts.testExpert')}</Button>}
            <Switch checked={item.enabled} onChange={() => void toggleEnabled(item)} label={t('status')} />
            <Button size="sm" variant="outline" icon={<IconTrashOutlineRegular size={14} />} onClick={() => setDeleting(item)}>{t('delete')}</Button>
          </div>
        </article>)}
      </div>
      <Pagination page={experts.page} total={experts.total} onPageChange={experts.setPage} t={t} />
      {!state.experts.some(item => item.source !== 'team'
        && [item.name, item.description, ...item.tags].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        && <p className={css.empty}>{t('noData')}</p>}

      <Modal
        open={form.name !== undefined}
        onClose={() => { if (!saving) { setEditing(null); setForm({}) } }}
        title={nativeImport ? t('experts.importOriginal') : editing != null ? t('experts.editExpert') : t('experts.addExpert')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" disabled={saving} onClick={() => { setEditing(null); setForm({}) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={saving || (nativeImport && !importPreview)}>{t('save')}</Button>
          </>
        )}
      >
        <div className={css.form}>
          {nativeImport ? <ExpertParameterImport value={importText} preview={importPreview} busy={saving} t={t}
            onChange={value => { setImportText(value); setImportPreview(null) }} onError={showToast}
            onValidate={() => {
              setSaving(true)
              void Promise.resolve().then(() => request<ExpertImportPreview>('/admin/experts/import', { method: 'POST',
                body: JSON.stringify({ definition: JSON.parse(importText), preview: true, ...(editing ? { targetId: editing.id } : {}),
                  scope: form.scope, scopeTarget: form.scopeTarget, enabled: form.enabled }) }))
                .then(preview => {
                  if (preview.expert.source === 'team') { showToast(t('experts.teamImportUnavailable')); return }
                  setImportPreview(preview)
                }).catch((error: unknown) => { setImportPreview(null); showToast(error instanceof ApiError && [502, 503, 504].includes(error.status)
                  ? t('experts.importServiceUnavailable')
                  : error instanceof SyntaxError ? t('experts.importInvalid') : error instanceof Error ? error.message : t('experts.importInvalid')) })
                .finally(() => setSaving(false))
            }} /> : <>          <label className={css.field}>
            <span>{t('experts.expertName')}</span>
            <Input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <label className={css.field}>
            <span>{t('description')}</span>
            <Input value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </label>
          <label className={css.field}>
            <span>{t('experts.tags')}</span>
            <Input value={(form.tags ?? []).join('，')} placeholder={t('experts.tagsHint')}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) }))} />
          </label>
          <label className={css.field}>
            <span>{t('experts.source')}</span>
            <select value={form.source ?? 'bailian'} onChange={e => { setDifyInputsText('{}'); setForm(f => ({ ...f,
              source: e.target.value as Expert['source'], externalConfig: { appId: '', workspaceId: '', apiUrl: '', agentId: '', apiKey: '' },
            })) }}>
              <option value="bailian">{t('experts.sourceBailian')}</option>
              <option value="dify">{t('experts.sourceDify')}</option>
              <option value="weknora">{t('experts.sourceWeKnora')}</option>

              {editing?.source === 'external' && <option value="external">{t('experts.sourceExternal')}</option>}
            </select>
          </label>
          {form.source === 'bailian' && <>
            <label className={css.field}><span>{t('experts.appId')}</span>
              <Input value={form.externalConfig?.appId ?? ''} onChange={e => setForm(f => ({ ...f,
                externalConfig: { apiKey: f.externalConfig?.apiKey ?? '', ...f.externalConfig, appId: e.target.value.trim() },
              }))} /></label>
            <label className={css.field}><span>{t('experts.workspaceId')}</span>
              <Input value={form.externalConfig?.workspaceId ?? ''} onChange={e => setForm(f => ({ ...f,
                externalConfig: { apiKey: f.externalConfig?.apiKey ?? '', ...f.externalConfig, workspaceId: e.target.value.trim() },
              }))} /></label>
            <label className={css.field}><span>{t('experts.apiKey')}</span>
              <Input type="password" autoComplete="new-password" value={form.externalConfig?.apiKey ?? ''}
                placeholder={editing?.hasApiKey ? t('experts.keySaved') : 'sk-...'} onChange={e => setForm(f => ({ ...f,
                  externalConfig: { ...f.externalConfig, apiKey: e.target.value },
                }))} /></label>
          </>}
          {form.source === 'dify' && <>
            <p className={css.hint}>{t('experts.difyHint')}</p>
            <label className={css.field}><span>{t('experts.difyApiUrl')}</span>
              <Input value={form.externalConfig?.apiUrl ?? ''} placeholder="https://api.dify.ai/v1"
                onChange={e => setForm(f => ({ ...f, externalConfig: { ...f.externalConfig,
                  apiKey: f.externalConfig?.apiKey ?? '', apiUrl: e.target.value.trim() } }))} /></label>
            <label className={css.field}><span>{t('experts.difyApiKey')}</span>
              <Input type="password" autoComplete="new-password" value={form.externalConfig?.apiKey ?? ''}
                placeholder={editing?.source === 'dify' && editing.hasApiKey ? t('experts.keySaved') : 'app-...'}
                onChange={e => setForm(f => ({ ...f, externalConfig: { ...f.externalConfig, apiKey: e.target.value } }))} /></label>
            <label className={css.field}><span>{t('experts.difyInputs')}</span>
              <textarea rows={3} value={difyInputsText} onChange={e => setDifyInputsText(e.target.value)} /></label>
          </>}
          {form.source === 'weknora' && <>
            <p className={css.hint}>{t('experts.weknoraHint')}</p>
            <label className={css.field}><span>{t('experts.weknoraApiUrl')}</span>
              <Input value={form.externalConfig?.apiUrl ?? ''} placeholder="http://8.216.38.213:8089/api/v1"
                onChange={e => setForm(f => ({ ...f, externalConfig: { ...f.externalConfig,
                  apiKey: f.externalConfig?.apiKey ?? '', apiUrl: e.target.value.trim() } }))} /></label>
            <label className={css.field}><span>{t('experts.weknoraAgentId')}</span>
              <Input value={form.externalConfig?.agentId ?? ''} onChange={e => setForm(f => ({ ...f,
                externalConfig: { ...f.externalConfig, apiKey: f.externalConfig?.apiKey ?? '', agentId: e.target.value.trim() },
              }))} /></label>
            <label className={css.field}><span>{t('experts.weknoraApiKey')}</span>
              <Input type="password" autoComplete="new-password" value={form.externalConfig?.apiKey ?? ''}
                placeholder={editing?.source === 'weknora' && editing.hasApiKey ? t('experts.keySaved') : 'sk-...'}
                onChange={e => setForm(f => ({ ...f, externalConfig: { ...f.externalConfig, apiKey: e.target.value } }))} /></label>
          </>}
          {form.source === 'external' && <label className={css.field}><span>{t('experts.apiConfig')}</span>
            <Input value={form.externalConfig?.apiUrl ?? ''} onChange={e => setForm(f => ({ ...f,
              externalConfig: { apiKey: f.externalConfig?.apiKey ?? '', ...f.externalConfig, apiUrl: e.target.value },
            }))} /></label>}
          </>}
          <ScopePicker scope={form.scope ?? 'all'} targets={form.scopeTarget ?? []}
            departments={state.departments} employees={state.employees} disabled={saving} t={t}
            onChange={(scope, scopeTarget) => { setImportPreview(null); setForm(f => ({ ...f, scope, scopeTarget })) }} />
          <label className={css.fieldRow}>
            <span>{t('status')}</span>
            <Switch checked={form.enabled ?? false} disabled={saving} onChange={checked => { setImportPreview(null); setForm(f => ({ ...f, enabled: checked })) }} label={t('status')} />
          </label>
        </div>
      </Modal>

      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={t('experts.deleteExpert')}
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
    </div>
  )
}
