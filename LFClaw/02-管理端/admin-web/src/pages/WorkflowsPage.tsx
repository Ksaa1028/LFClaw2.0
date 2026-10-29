/** 管理员只读工作流目录，不加载正文、产物或处理操作。 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { request } from '../api.ts'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { PageShell } from '../components/PageShell.tsx'
import type { Translate } from '../locales/index.ts'
import css from './UsagePage.module.css'
interface Row { id: string; title: string; creator: { name: string; department: string }; assignee: { name: string; department: string };
  status: 'processing' | 'review' | 'supplement' | 'confirmation' | 'completed' | 'cancelled'; deadline: string; createdAt: string; updatedAt: string; overdue: boolean }
/** 查询当前目录并在本页筛选。
 * @param props - 管理端翻译服务。
 * @returns 只读目录。
 */
export function WorkflowsPage({ t }: { t: Translate }): ReactNode {
  const [rows, setRows] = useState<Row[]>([]), [revision, setRevision] = useState(0), [error, setError] = useState(false), [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setLoading(true)
    void request<Row[]>('/admin/workflows', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setRows(value); setError(false) }
    }).catch((_error: unknown) => { if (!controller.signal.aborted) setError(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])
  const columns: Column<Row>[] = [
    { key: 'title', title: t('workflow.title'), render: w => w.title },
    { key: 'creator', title: t('workflow.creator'), render: w => `${w.creator.name} · ${w.creator.department}` },
    { key: 'assignee', title: t('workflow.assignee'), render: w => `${w.assignee.name} · ${w.assignee.department}` },
    { key: 'status', title: t('workflow.status'), render: w => `${t(`workflow.${w.status}`)}${w.overdue ? ` · ${t('workflow.overdue')}` : ''}` },
    { key: 'deadline', title: t('workflow.deadline'), render: w => new Date(w.deadline).toLocaleString() },
    { key: 'createdAt', title: t('workflow.createdAt'), render: w => new Date(w.createdAt).toLocaleString() },
    { key: 'updatedAt', title: t('workflow.updatedAt'), render: w => new Date(w.updatedAt).toLocaleString() },
  ]
  const filtered = rows.filter(w => (!status || w.status === status) && (!from || w.createdAt.slice(0, 10) >= from) && (!to || w.createdAt.slice(0, 10) <= to)
    && `${w.title} ${w.creator.name} ${w.creator.department} ${w.assignee.name} ${w.assignee.department}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <PageShell title={t('workflow.panel')} subtitle={t('workflow.description')} action={<Button disabled={loading} onClick={() => setRevision(n => n + 1)}>{t('refresh')}</Button>}>
    <div className={css.filters}><label>{t('workflow.search')}<Input value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>{t('workflow.status')}<select value={status} onChange={e => setStatus(e.target.value)}><option value="">{t('all')}</option>
        {(['processing', 'review', 'supplement', 'confirmation', 'completed', 'cancelled'] as const).map(s => <option key={s} value={s}>{t(`workflow.${s}`)}</option>)}</select></label>
      <label>{t('usage.from')}<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>{t('usage.to')}<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
    {error && <p role="alert">{t('workflow.failed')}</p>}{loading && <p>{t('loading')}</p>}
    <DataTable columns={columns} data={filtered} t={t} rowKey={w => w.id}  />
  </PageShell>
}
