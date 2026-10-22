import { useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdminLocaleKey } from '../locales/index.ts'
import { PageShell } from '../components/PageShell.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { useAppState } from '../store.ts'
import { type OperationLog, type SystemError } from '../mock/data.ts'
import css from './SystemStatusPage.module.css'
import { loadSystemStatus } from '../api.ts'
import { BrandingSettings } from './BrandingSettings.tsx'

interface SystemStatusPageProps {
  showToast: (text: string, tone?: 'success') => void
  t: (key: AdminLocaleKey, values?: Record<string, string | number>) => string
}

export function SystemStatusPage({ t, showToast }: SystemStatusPageProps) {
  const { state } = useAppState()
  const [metric, setMetric] = useState(state.systemMetric)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    try { setMetric(await loadSystemStatus()); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('system.statusFailed')) }
    finally { setBusy(false) }
  }
  const percentage = (value: number | null) => value == null ? '—' : `${value}%`
  const resourceNames: Record<string, string> = {
    departments: t('nav.departments'), employees: t('nav.employees'), models: t('nav.models'),
    skills: t('nav.skills'), connectors: t('nav.connectors'), experts: t('nav.experts'),
    branding: t('branding.title'),
  }
  const operationType = (type: string): string => {
    if (type === 'reset:activation') return t('system.opResetActivation')
    if (type === 'change:admin-password') return t('system.opChangePassword')
    const [action, collection] = type.split(':')
    const resource = resourceNames[collection ?? '']
    if (!resource) return t('system.unknownOperation')
    if (action === 'create') return t('system.opCreate', { resource })
    if (action === 'update') return t('system.opUpdate', { resource })
    if (action === 'delete') return t('system.opDelete', { resource })
    if (action === 'permission') return t('system.opPermission', { resource })
    return t('system.unknownOperation')
  }
  const operationChange = (change: string): string => change.replace(/：(allow|deny|inherit)$/, (_, decision: string) =>
    `：${decision === 'allow' ? t('employees.allow') : decision === 'deny' ? t('employees.deny') : t('employees.inherit')}`)

  const logColumns: Column<OperationLog>[] = [
    { key: 'time', title: t('system.logTime'), render: l => l.time },
    { key: 'type', title: t('system.logType'), render: l => operationType(l.type) },
    { key: 'object', title: t('system.logObject'), render: l => l.object },
    { key: 'change', title: t('system.logChange'), render: l => operationChange(l.change) },
    { key: 'operator', title: t('system.logOperator'), render: l => l.operator === 'admin' ? t('system.operatorAdmin') : l.operator },
  ]

  const errorColumns: Column<SystemError>[] = [
    { key: 'time', title: t('system.logTime'), render: e => e.time },
    { key: 'source', title: t('system.errorSource'), render: e => e.source },
    { key: 'message', title: t('system.errorMessage'), render: e => e.message },
  ]

  return (
    <PageShell title={t('system.title')} subtitle={t('system.subtitle')} action={<Button variant="ghost" disabled={busy} onClick={() => void refresh()}>{t('refresh')}</Button>}>
      {error && <p role="alert">{error}</p>}
      <BrandingSettings t={t} showToast={showToast} />
      <section className={css.metrics}>
        <div className={css.metricCard}>
          <h3>{t('system.cpuUsage')}</h3>
          <p className={css.metricValue}>{percentage(metric.cpuPercent)}</p>
        </div>
        <div className={css.metricCard}>
          <h3>{t('system.memoryUsage')}</h3>
          <p className={css.metricValue}>{percentage(metric.memoryPercent)}</p>
        </div>
        <div className={css.metricCard}>
          <h3>{t('system.diskUsage')}</h3>
          <p className={css.metricValue}>{percentage(metric.diskPercent)}</p>
        </div>
        <div className={css.metricCard}>
          <h3>{t('system.gatewayStatus')}</h3>
          <Tag tone={metric.gatewayStatus === 'online' ? 'success' : 'danger'}>
            {metric.gatewayStatus === 'online' ? t('system.online') : t('system.offline')}
          </Tag>
        </div>
      </section>

      <h3 className={css.sectionTitle}>{t('system.operationLogs')}</h3>
      <DataTable columns={logColumns} data={state.operationLogs} rowKey={l => l.id} emptyText={t('noData')} t={t} />

      <h3 className={css.sectionTitle}>{t('system.recentErrors')}</h3>
      <DataTable columns={errorColumns} data={state.systemErrors} rowKey={e => e.id} emptyText={t('noData')} t={t} />
    </PageShell>
  )
}
