/** 管理员维护员工端首页文案，保存失败时保留编辑内容。 */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../locales/index.ts'
import { request } from '../api.ts'
import css from './BrandingSettings.module.css'

interface Branding { headline: string; badge: string; showBadge: boolean }

/** 首页文案配置表单。
 * @param props - 本地化函数和全局操作提示。
 * @returns 配置、预览与保存操作。
 */
export function BrandingSettings({ t, showToast }: { t: Translate; showToast: (text: string, tone?: 'success') => void }) {
  const [draft, setDraft] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void request<Branding>('/admin/branding', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setDraft(value); setFailed(false) }
    }).catch((_error: unknown) => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [attempt])
  return <section className={css.card}>
    <h3>{t('branding.title')}</h3>
    <p>{t('branding.description')}</p>
    {failed && <p role="alert">{t('branding.loadFailed')} <Button onClick={() => setAttempt(value => value + 1)}>{t('refresh')}</Button></p>}
    {draft && <form className={css.form} onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true)
      try {
        const saved = await request<Branding>('/admin/branding', { method: 'PUT', body: JSON.stringify(draft) })
        setDraft(saved)
        showToast(t('branding.saved'), 'success')
      } catch (error) { showToast(error instanceof Error ? error.message : t('branding.saveFailed')) }
      finally { setBusy(false) }
    }}>
      <label className={css.field}>{t('branding.headline')}<Input required maxLength={40} disabled={busy} value={draft.headline} onChange={event => setDraft({ ...draft, headline: event.target.value })} /></label>
      <label className={css.field}>{t('branding.badge')}<Input required={draft.showBadge} maxLength={12} disabled={busy} value={draft.badge} onChange={event => setDraft({ ...draft, badge: event.target.value })} /></label>
      <label><input type="checkbox" disabled={busy} checked={draft.showBadge} onChange={event => setDraft({ ...draft, showBadge: event.target.checked })} /> {t('branding.showBadge')}</label>
      <div className={css.preview} aria-label={t('branding.preview')}><span>{draft.headline}</span>{draft.showBadge && <small>{draft.badge}</small>}</div>
      <Button type="submit" variant="primary" disabled={busy || !draft.headline.trim() || (draft.showBadge && !draft.badge.trim())}>{t('save')}</Button>
    </form>}
  </section>
}
