import { useRef, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdminLocaleKey } from '../locales/index.ts'
import { PageShell } from '../components/PageShell.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { useAppState } from '../store.ts'
import { type BackupRecord, formatDate, formatSize } from '../mock/data.ts'
import { createManualBackup, deleteBackup, downloadBackup, loadData, restoreSavedBackup, restoreUploadedBackup } from '../api.ts'
import css from './BackupPage.module.css'

interface BackupPageProps {
  t: (key: AdminLocaleKey, values?: Record<string, string | number>) => string
  showToast: (text: string, tone?: 'success') => void
}

export function BackupPage({ t, showToast }: BackupPageProps) {
  const { state, dispatch } = useAppState()
  const [busy, setBusy] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  const reload = async () => { await dispatch({ type: 'HYDRATE', payload: await loadData() }) }
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    try { await action(); await reload(); showToast(success, 'success') }
    catch (error) { showToast(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  const confirmRestore = () => window.confirm(`${t('backup.restoreWarning')}\n${t('backup.restoreSecondConfirm')}`)

  const columns: Column<BackupRecord>[] = [
    { key: 'name', title: t('name'), render: b => b.name.startsWith('manual-backup-')
      ? t('backup.manualBackupName', { date: b.name.slice('manual-backup-'.length) }) : b.name },
    { key: 'type', title: t('backup.backupType'), render: b => t(('backup.' + b.type) as AdminLocaleKey) },
    { key: 'size', title: t('backup.backupSize'), render: b => formatSize(b.sizeBytes) },
    { key: 'status', title: t('backup.backupStatus'), render: b => <Tag tone={b.status === 'success' ? 'success' : 'danger'}>{t(('backup.status' + b.status.charAt(0).toUpperCase() + b.status.slice(1)) as AdminLocaleKey)}</Tag> },
    { key: 'createdAt', title: t('backup.backupTime'), render: b => formatDate(b.createdAt) },
    { key: 'actions', title: t('actions'), render: b => (
      <div className={css.actions}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => downloadBackup(b.id), t('download'))}>{t('download')}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (confirmRestore()) void run(() => restoreSavedBackup(b.id), t('backup.restore')) }}>{t('backup.restore')}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
          if (window.confirm(t('backup.confirmDelete', { name: b.name.startsWith('manual-backup-')
            ? t('backup.manualBackupName', { date: b.name.slice('manual-backup-'.length) }) : b.name }))) {
            void run(() => deleteBackup(b.id), t('backup.deleted'))
          }
        }}>{t('delete')}</Button>
      </div>
    )},
  ]

  const handleBackup = () => void run(async () => { await createManualBackup() }, t('backup.backupNow'))
  const handleUpload = (file: File | undefined) => {
    if (file && confirmRestore()) void run(() => restoreUploadedBackup(file), t('backup.restore'))
    if (uploadRef.current) uploadRef.current.value = ''
  }

  return (
    <PageShell title={t('backup.title')} subtitle={t('backup.subtitle')} action={<><Button variant="primary" disabled={busy} onClick={handleBackup}>{t('backup.backupNow')}</Button><Button variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>{t('backup.restore')}</Button><input ref={uploadRef} type="file" accept=".zip,application/zip" hidden onChange={event => handleUpload(event.target.files?.[0])} /></>}>
      <DataTable columns={columns} data={state.backups} rowKey={b => b.id} emptyText={t('noData')} t={t} />
    </PageShell>
  )
}
