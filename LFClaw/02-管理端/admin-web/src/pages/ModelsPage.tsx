import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  Button,
  IconEditOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { DataTable } from '../components/DataTable.tsx'
import { ScopePicker } from '../components/ScopePicker.tsx'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import type { Column } from '../components/DataTable.tsx'
import type { Model } from '../mock/data.ts'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './ModelsPage.module.css'
import { testModel } from '../api.ts'

export interface ModelsPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

const PROTOCOL_OPTIONS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bailian', label: '阿里云百炼' },
  { value: 'other', label: '其他' },
]

export function ModelsPage({ t, showToast }: ModelsPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const [editing, setEditing] = useState<Model | null>(null)
  const [deleting, setDeleting] = useState<Model | null>(null)
  const [testing, setTesting] = useState<Model | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency?: number } | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [form, setForm] = useState<Partial<Model>>({})
  const [saving, setSaving] = useState(false)

  const openAdd = useCallback(() => {
    setEditing(null)
    setForm({ name: '', contextWindow: 32768, maxTokens: 8192, upstreamModelId: '', type: 'text', protocol: 'openai-compatible', baseUrl: '', apiKey: '', enabled: true, isDefault: false, pricePerMillionInput: null, pricePerMillionOutput: null, currency: 'CNY', scope: 'all', scopeTarget: [] })
  }, [])

  const openEdit = useCallback((model: Model) => {
    setEditing(model)
    setForm({ ...model, contextWindow: model.contextWindow ?? 32768, maxTokens: model.maxTokens ?? 8192 })
  }, [])

  const save = useCallback(async () => {
    if (saving) return
    const name = (form.name ?? '').trim()
    if (name === '') return
    if (typeof form.contextWindow !== 'number' || typeof form.maxTokens !== 'number' || !Number.isSafeInteger(form.contextWindow) || !Number.isSafeInteger(form.maxTokens)
      || (form.contextWindow ?? 0) <= 0 || (form.maxTokens ?? 0) <= 0 || form.maxTokens > form.contextWindow) {
      showToast(t('models.invalidCapacity')); return
    }
    setSaving(true)
    const payload: Model = {
      id: editing?.id ?? 'm-' + Date.now(),
      name,
      contextWindow: form.contextWindow,
      maxTokens: form.maxTokens,
      upstreamModelId: (form.upstreamModelId ?? '').trim(),
      enableThinking: form.enableThinking ?? null,
      pricePerMillionInput: form.pricePerMillionInput ?? null,
      pricePerMillionOutput: form.pricePerMillionOutput ?? null,
      currency: (form.currency ?? 'CNY').trim().toUpperCase(),
      type: form.type ?? 'text',
      protocol: form.protocol ?? 'openai-compatible',
      baseUrl: (form.baseUrl ?? '').trim(),
      apiKey: (form.apiKey ?? '').trim(),
      enabled: form.enabled ?? false,
      isDefault: form.isDefault ?? false,
      scope: form.scope ?? 'all',
      scopeTarget: (form.scope === 'all' || form.scope === 'none') ? [] : form.scopeTarget ?? [],
    }
    try {
      const ok = await dispatch(editing != null ? { type: 'UPDATE_MODEL', payload } : { type: 'ADD_MODEL', payload })
      if (ok) { showToast(t('save'), 'success'); setEditing(null); setForm({}) }
    } finally { setSaving(false) }
  }, [saving, editing, form, dispatch, showToast, t])

  const confirmDelete = useCallback(async () => {
    if (deleting == null) return
    if (await dispatch({ type: 'DELETE_MODEL', payload: deleting.id })) { showToast(t('delete'), 'success'); setDeleting(null) }
  }, [deleting, dispatch, showToast, t])

  const toggleDefault = useCallback(async (model: Model) => {
    const updated = { ...model, isDefault: !model.isDefault }
    await dispatch({ type: 'UPDATE_MODEL', payload: updated })
  }, [dispatch])

  const runTest = useCallback(async (model: Model) => {
    setTestLoading(true)
    setTestResult(null)
    try {
      const result = await testModel(model.id)
      setTestResult({ ok: true, message: '连接成功，模型已响应', latency: result.latencyMs })
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : '模型测试失败' })
    } finally {
      setTestLoading(false)
    }
  }, [])

  const columns: Column<Model>[] = useMemo(() => [
    { key: 'name', title: t('name'), render: row => row.name },
    { key: 'type', title: t('type'), render: row => row.type === 'text' ? '文本' : row.type === 'image' ? '图像' : row.type === 'audio' ? '音频' : '视频' },
    { key: 'protocol', title: t('models.protocol'), render: row => {
      const opt = PROTOCOL_OPTIONS.find(o => o.value === row.protocol)
      return opt?.label ?? row.protocol
    }},
    {
      key: 'isDefault',
      title: '默认',
      render: row => (
        <Switch checked={row.isDefault} onChange={() => toggleDefault(row)} label="默认" />
      ),
    },
    {
      key: 'status',
      title: t('status'),
      render: row => <Tag tone={row.enabled ? 'success' : 'danger'}>{row.enabled ? t('active') : t('inactive')}</Tag>,
    },
    { key: 'scope', title: t('models.scope'), render: row => row.scope === 'none' ? t('distribution.none') : row.scope === 'department' || row.scope === 'employee'
      ? `${row.scope === 'department' ? t('distribution.departments') : t('distribution.employees')} · ${row.scopeTarget?.length ?? 0}`
      : t('distribution.all') },
    {
      key: 'actions',
      title: t('actions'),
      width: '280px',
      render: row => (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'nowrap' }}>
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
            onClick={() => { setTesting(row); setTestResult(null); runTest(row) }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px', whiteSpace: 'nowrap' }}
          >
            <IconPlayOutlineRegular size={14} />
            <span>{t('test')}</span>
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
  ], [t, openEdit, toggleDefault, runTest])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('models.title')}</h1>
          <p>{t('models.subtitle')}</p>
        </div>
        <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={openAdd}>
          {t('models.addModel')}
        </Button>
      </header>

      <DataTable columns={columns} data={state.models} rowKey={row => row.id} emptyText={t('noData')} t={t} />

      <Modal
        open={form.name !== undefined}
        onClose={() => { if (!saving) { setEditing(null); setForm({}) } }}
        title={editing != null ? t('models.editModel') : t('models.addModel')}
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
            <span>{t('models.modelName')}</span>
            <Input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={saving} placeholder="例如：qwen-plus" />
          </label>
          <label className={css.field}>
            <span>{t('models.upstreamModelId')}</span>
            <Input value={form.upstreamModelId ?? ''} onChange={e => setForm(f => ({ ...f, upstreamModelId: e.target.value }))} disabled={saving} placeholder="例如：qwen-plus" />
          </label>
          {(['contextWindow', 'maxTokens'] as const).map(field => (
            <label className={css.field} key={field}>
              <span>{t(`models.${field}`)}</span>
              <Input type="number" min={1} step={1} value={form[field] ?? ''}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value === '' ? undefined : Number(e.target.value) }))} disabled={saving} />
            </label>
          ))}
          <label className={css.field}>
            <span>{t('models.thinkingMode')}</span>
            <select value={form.enableThinking == null ? 'default' : form.enableThinking ? 'on' : 'off'}
              onChange={e => setForm(f => ({ ...f, enableThinking: e.target.value === 'default' ? null : e.target.value === 'on' }))}
              disabled={saving}>
              <option value="default">{t('models.thinkingDefault')}</option>
              <option value="on">{t('models.thinkingOn')}</option>
              <option value="off">{t('models.thinkingOff')}</option>
            </select>
          </label>
          <label className={css.field}>
            <span>{t('type')}</span>
            <select value={form.type ?? 'text'} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} disabled={saving}>
              <option value="text">文本</option>
              <option value="image">图像</option>
              <option value="audio">音频</option>
              <option value="video">视频</option>
            </select>
          </label>
          <label className={css.field}>
            <span>{t('models.protocol')}</span>
            <select value={form.protocol ?? 'openai-compatible'} onChange={e => setForm(f => ({ ...f, protocol: e.target.value }))} disabled={saving}>
              {PROTOCOL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className={css.field}>
            <span>{t('models.baseUrl')}</span>
            <Input value={form.baseUrl ?? ''} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} disabled={saving} autoComplete="off" placeholder="例如：https://dashscope.aliyuncs.com/compatible-mode/v1" />
          </label>
          <label className={css.field}>
            <span>{t('models.apiKey')}</span>
            <Input value={form.apiKey ?? ''} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} disabled={saving} autoComplete="new-password" placeholder="sk-..." type="password" />
          </label>
          <label className={css.field}>
            <span>{t('models.inputPrice')}</span>
            <Input type="number" value={form.pricePerMillionInput ?? ''}
              onChange={e => setForm(f => ({ ...f, pricePerMillionInput: e.target.value === '' ? null : Number(e.target.value) }))}
              disabled={saving} />
          </label>
          <label className={css.field}>
            <span>{t('models.outputPrice')}</span>
            <Input type="number" value={form.pricePerMillionOutput ?? ''}
              onChange={e => setForm(f => ({ ...f, pricePerMillionOutput: e.target.value === '' ? null : Number(e.target.value) }))}
              disabled={saving} />
          </label>
          <label className={css.field}>
            <span>{t('models.currency')}</span>
            <Input value={form.currency ?? 'CNY'} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} disabled={saving} placeholder="CNY" />
          </label>
          <label className={css.fieldRow}>
            <span>默认模型</span>
            <Switch checked={form.isDefault ?? false} onChange={checked => setForm(f => ({ ...f, isDefault: checked }))} label="默认模型" disabled={saving} />
          </label>
          <label className={css.fieldRow}>
            <span>{t('status')}</span>
            <Switch checked={form.enabled ?? false} onChange={checked => setForm(f => ({ ...f, enabled: checked }))} label={t('status')} disabled={saving} />
          </label>
          <ScopePicker scope={form.scope ?? 'all'} targets={form.scopeTarget ?? []}
            departments={state.departments} employees={state.employees} disabled={saving} t={t}
            onChange={(scope, scopeTarget) => setForm(f => ({ ...f, scope, scopeTarget }))} />
        </div>
      </Modal>

      <Modal
        open={testing != null}
        onClose={() => { setTesting(null); setTestResult(null) }}
        title={t('models.testModel')}
        closeLabel={t('close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setTesting(null); setTestResult(null) }}>{t('close')}</Button>
            <Button variant="primary" onClick={() => testing && runTest(testing)} disabled={testLoading}>
              {testLoading ? '测试中...' : '重新测试'}
            </Button>
          </>
        )}
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 12, fontSize: 14, color: '#666' }}>
            模型：<strong>{testing?.name}</strong>
          </div>
          <div style={{ marginBottom: 12, fontSize: 14, color: '#666' }}>
            地址：<code style={{ fontFamily: 'monospace', fontSize: 12 }}>{testing?.baseUrl}</code>
          </div>
          {testLoading && (
            <div style={{ padding: 16, textAlign: 'center', color: '#888' }}>正在测试连接...</div>
          )}
          {testResult && (
            <div style={{
              padding: 16,
              borderRadius: 8,
              background: testResult.ok ? '#f0fdf4' : '#fef2f2',
              border: '1px solid ' + (testResult.ok ? '#bbf7d0' : '#fecaca'),
            }}>
              <div style={{ fontWeight: 600, color: testResult.ok ? '#16a34a' : '#dc2626', marginBottom: 8 }}>
                {testResult.ok ? '✓ 连接成功' : '✗ 连接失败'}
              </div>
              <div style={{ fontSize: 13, color: '#333', wordBreak: 'break-all' }}>{testResult.message}</div>
              {testResult.latency != null && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>延迟：{testResult.latency}ms</div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title={t('models.deleteModel')}
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
