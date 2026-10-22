import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { loadUsageReport, type UsageReport, type UsageSummaryRow } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PageShell } from '../components/PageShell.tsx'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './UsagePage.module.css'

interface Filters {
  from: string
  to: string
  employeeId: string
  modelId: string
}

const emptyFilters: Filters = { from: '', to: '', employeeId: '', modelId: '' }

/** Administrator-only summary of employee gateway usage. */
export function UsagePage({ t }: { t: Translate }): ReactNode {
  const { state } = useAppState()
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [revision, setRevision] = useState(0)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setReport(null)
    setError('')
    void loadUsageReport(filters, controller.signal).then(value => {
      if (!controller.signal.aborted) setReport(value)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('usage.loadFailed'))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, revision, t])

  const apply = () => {
    if (draft.from && draft.to && draft.from > draft.to) { setError(t('usage.invalidRange')); return }
    setFilters({ ...draft })
  }
  const reset = () => { setDraft(emptyFilters); setFilters(emptyFilters); setRevision(value => value + 1) }
  const columns: Column<UsageSummaryRow>[] = [
    { key: 'name', title: t('usage.name'), render: row => row.name },
    { key: 'calls', title: t('usage.calls'), render: row => row.calls.toLocaleString() },
    { key: 'input', title: t('usage.inputTokens'), render: row => row.inputTokens.toLocaleString() },
    { key: 'output', title: t('usage.outputTokens'), render: row => row.outputTokens.toLocaleString() },
    { key: 'total', title: t('usage.totalTokens'), render: row => row.totalTokens.toLocaleString() },
    { key: 'missing', title: t('usage.missingCalls'), render: row => row.missingTokenCalls.toLocaleString() },
  ]

  return <PageShell title={t('usage.title')} subtitle={t('usage.subtitle')}
    action={<Button variant="ghost" disabled={loading} onClick={() => setRevision(value => value + 1)}>{t('refresh')}</Button>}>
    <div className={css.filters}>
      <label>{t('usage.from')}<input type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label>
      <label>{t('usage.to')}<input type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label>
      <label>{t('usage.employee')}<select value={draft.employeeId} onChange={event => setDraft(value => ({ ...value, employeeId: event.target.value }))}>
        <option value="">{t('all')}</option>
        {state.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </select></label>
      <label>{t('usage.model')}<select value={draft.modelId} onChange={event => setDraft(value => ({ ...value, modelId: event.target.value }))}>
        <option value="">{t('all')}</option>
        {state.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select></label>
      <div className={css.actions}>
        <Button variant="primary" onClick={apply}>{t('filter')}</Button>
        <Button variant="ghost" onClick={reset}>{t('reset')}</Button>
      </div>
    </div>
    <p className={css.note}>{t('usage.utcNote')}</p>
    {error && <p role="alert" className={css.error}>{error} <Button size="sm" variant="ghost" onClick={() => setRevision(value => value + 1)}>{t('refresh')}</Button></p>}
    {loading && <p role="status">{t('loading')}</p>}
    {report && <>
      <div className={css.totals}>
        <span>{t('usage.calls')}: {report.total.calls.toLocaleString()}</span>
        <span>{t('usage.inputTokens')}: {report.total.inputTokens.toLocaleString()}</span>
        <span>{t('usage.outputTokens')}: {report.total.outputTokens.toLocaleString()}</span>
        <span>{t('usage.totalTokens')}: {report.total.totalTokens.toLocaleString()}</span>
        <span>{t('usage.missingCalls')}: {report.total.missingTokenCalls.toLocaleString()}</span>
      </div>
      <section className={css.section}><h2>{t('usage.byEmployee')}</h2>
        <DataTable columns={columns} data={report.employees} rowKey={row => row.id} emptyText={t('noData')} t={t} />
      </section>
      <section className={css.section}><h2>{t('usage.byModel')}</h2>
        <DataTable columns={columns} data={report.models} rowKey={row => row.id} emptyText={t('noData')} t={t} />
      </section>
    </>}
  </PageShell>
}
