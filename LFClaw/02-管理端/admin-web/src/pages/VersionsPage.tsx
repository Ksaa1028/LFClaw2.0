import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdminLocaleKey } from '../locales/index.ts'
import { PageShell } from '../components/PageShell.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { useAppState } from '../store.ts'
import { type VersionPackage, type EmployeeVersionReport, formatDate, formatSize } from '../mock/data.ts'
import css from './VersionsPage.module.css'

interface VersionsPageProps {
  t: (key: AdminLocaleKey, values?: Record<string, string | number>) => string
  showToast: (text: string, tone?: 'success') => void
}

export function VersionsPage({ t }: VersionsPageProps) {
  const { state } = useAppState()

  const packageColumns: Column<VersionPackage>[] = [
    { key: 'version', title: t('versions.version'), render: v => v.version },
    { key: 'platform', title: t('versions.platform'), render: v => t(('versions.' + v.platform) as AdminLocaleKey) },
    { key: 'size', title: t('versions.size'), render: v => formatSize(v.sizeBytes) },
    { key: 'publishedAt', title: t('versions.releaseTime'), render: v => formatDate(v.publishedAt) },
    { key: 'forceUpdate', title: t('versions.forceUpdate'), render: v => <Switch checked={v.forceUpdate} onChange={() => {}} disabled label={t('versions.forceUpdate')} /> },
    { key: 'status', title: t('status'), render: v => <Tag tone={v.status === 'published' ? 'success' : 'warning'}>{v.status === 'published' ? t('versions.statusPublished') : t('versions.statusDraft')}</Tag> },
    { key: 'actions', title: t('actions'), render: () => <Button variant="ghost" size="sm" disabled>{t('edit')}</Button> },
  ]

  const reportColumns: Column<EmployeeVersionReport>[] = [
    { key: 'employeeName', title: t('employees.employeeName'), render: r => r.employeeName },
    { key: 'platform', title: t('versions.platform'), render: r => t(('versions.' + r.platform) as AdminLocaleKey) },
    { key: 'version', title: t('versions.version'), render: r => r.version },
    { key: 'osVersion', title: t('versions.osVersion'), render: r => r.osVersion },
    { key: 'lastReportAt', title: t('versions.releaseTime'), render: r => formatDate(r.lastReportAt) },
    { key: 'updateStatus', title: t('versions.updateStatus'), render: r => <Tag tone={r.updateStatus === 'updated' ? 'success' : r.updateStatus === 'pending' ? 'warning' : 'danger'}>{t(('versions.status' + r.updateStatus.charAt(0).toUpperCase() + r.updateStatus.slice(1)) as AdminLocaleKey)}</Tag> },
  ]

  return (
    <PageShell title={t('versions.title')} subtitle={t('versions.subtitle')} action={<Button variant="primary" disabled>{t('versions.uploadVersion')}</Button>}>
      <h3 className={css.sectionTitle}>{t('versions.versionPackages')}</h3>
      <DataTable columns={packageColumns} data={state.versionPackages} rowKey={v => v.id} emptyText={t('noData')} t={t} />

      <h3 className={css.sectionTitle}>{t('versions.employeeReports')}</h3>
      <DataTable columns={reportColumns} data={state.employeeVersionReports} rowKey={r => r.employeeId} emptyText={t('noData')} t={t} />
    </PageShell>
  )
}
