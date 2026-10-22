import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { AdminModal as Modal } from './AdminModal.tsx'
import type { Translate } from '../locales/index.ts'
import css from './PasswordDialog.module.css'

export function PasswordDialog({ open, onClose, onSubmit, t }: {
  open: boolean
  onClose: () => void
  onSubmit: (current: string, next: string) => Promise<boolean>
  t: Translate
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const close = () => { setCurrent(''); setNext(''); setRepeat(''); setMismatch(false); onClose() }
  const submit = async () => {
    if (next !== repeat) { setMismatch(true); return }
    setBusy(true)
    try { if (await onSubmit(current, next)) close() }
    finally { setBusy(false) }
  }
  return <Modal open={open} onClose={close} title={t('passwordChange.title')} closeLabel={t('close')}
    footer={<><Button variant="ghost" onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={busy || next.length < 12} onClick={() => void submit()}>{t('confirm')}</Button></>}>
    <div className={css.fields}>
      <label className={css.field}><span>{t('passwordChange.current')}</span><Input type="password" value={current} onChange={event => setCurrent(event.target.value)} /></label>
      <label className={css.field}><span>{t('passwordChange.next')}</span><Input type="password" value={next} onChange={event => setNext(event.target.value)} /></label>
      <label className={css.field}><span>{t('passwordChange.repeat')}</span><Input type="password" value={repeat} onChange={event => { setRepeat(event.target.value); setMismatch(false) }} /></label>
      {mismatch && <p role="alert" className={css.error}>{t('passwordChange.mismatch')}</p>}
    </div>
  </Modal>
}
