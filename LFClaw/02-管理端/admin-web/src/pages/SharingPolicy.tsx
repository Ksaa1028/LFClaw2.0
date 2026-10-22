/** Administrator limits for temporary conversation shares. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { request } from '../api.ts'
import type { Translate } from '../locales/index.ts'
import css from './NotificationsPage.module.css'

/** Edit limits without changing the expiry of existing shares.
 * @param props - Locale and application feedback.
 * @returns Persistent share policy form.
 */
export function SharingPolicy({ t, showToast }: { t: Translate; showToast: (text: string, tone?: 'success') => void }) {
  const [days, setDays] = useState(''), [size, setSize] = useState(''), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void request<{ retentionDays: number; maxBytes: number }>('/admin/session-sharing').then(policy => {
      if (active) { setDays(String(policy.retentionDays)); setSize(String(policy.maxBytes / 1024 / 1024)); setError('') }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : t('sharing.failed')) })
    return () => { active = false }
  }, [retry, t])
  const save = async () => {
    const retentionDays = Number(days), maxBytes = Number(size) * 1024 * 1024
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 365 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 ** 3) {
      setError(t('sharing.invalid')); return
    }
    setBusy(true); setError('')
    try {
      await request('/admin/session-sharing', { method: 'PUT', body: JSON.stringify({ retentionDays, maxBytes }) })
      showToast(t('sharing.saved'), 'success')
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('sharing.failed')) }
    finally { setBusy(false) }
  }
  return <section className={css.card}>
    <h2>{t('sharing.title')}</h2><p>{t('sharing.hint')}</p>
    <label className={css.field}><span>{t('sharing.days')}</span><Input type="number" min={1} max={365} value={days} disabled={busy} onChange={e => { setDays(e.target.value) }} /></label>
    <label className={css.field}><span>{t('sharing.size')}</span><Input type="number" min={0.001} max={1024} step="any" value={size} disabled={busy} onChange={e => { setSize(e.target.value) }} /></label>
    {error && <p role="alert">{error}</p>}
    <div className={css.actions}><Button variant="outline" disabled={busy} onClick={() => { setRetry(value => value + 1) }}>{t('sharing.refresh')}</Button>
      <Button variant="primary" disabled={busy || !days || !size} onClick={() => { void save() }}>{t('sharing.save')}</Button></div>
  </section>
}
