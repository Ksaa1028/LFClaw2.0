import { useCallback, useState, type ReactNode } from 'react'
import {
  Button,
  Input,
  Modal,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import type { Notification } from '../mock/data.ts'
import css from './NotificationsPage.module.css'
import { SharingPolicy } from './SharingPolicy.tsx'
import { Pagination, usePaginatedData } from '../components/Pagination.tsx'

export interface NotificationsPageProps {
  t: Translate
  showToast: (text: string, tone?: 'success') => void
}

export function NotificationsPage({ t, showToast }: NotificationsPageProps): ReactNode {
  const { state, dispatch } = useAppState()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [revoking, setRevoking] = useState<Notification | null>(null)
  const [savingRevoke, setSavingRevoke] = useState(false)
  const [deleting, setDeleting] = useState<Notification | null>(null)
  const [savingDelete, setSavingDelete] = useState(false)
  const notifications = usePaginatedData(state.notifications)

  const publish = useCallback(async () => {
    if (publishing || title.trim() === '' || content.trim() === '') return
    setPublishing(true)
    const payload = {
      id: 'n-' + Date.now(),
      title: title.trim(),
      content: content.trim(),
      sentAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }
    try {
      if (await dispatch({ type: 'ADD_NOTIFICATION', payload })) {
        showToast(t('notifications.published'), 'success')
        setTitle('')
        setContent('')
        setPreview(false)
      }
    } finally { setPublishing(false) }
  }, [title, content, publishing, dispatch, showToast, t])

  const revoke = useCallback(async () => {
    if (!revoking || savingRevoke) return
    setSavingRevoke(true)
    try {
      if (await dispatch({ type: 'REVOKE_NOTIFICATION', payload: revoking })) {
        setRevoking(null)
        showToast(t('notifications.revoked'), 'success')
      }
    } finally { setSavingRevoke(false) }
  }, [revoking, savingRevoke, dispatch, showToast, t])

  const deleteRecalled = useCallback(async () => {
    if (!deleting?.revokedAt || savingDelete) return
    setSavingDelete(true)
    try {
      if (await dispatch({ type: 'DELETE_NOTIFICATION', payload: deleting.id })) {
        setDeleting(null)
        showToast(t('notifications.deleted'), 'success')
      }
    } finally { setSavingDelete(false) }
  }, [deleting, savingDelete, dispatch, showToast, t])

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('notifications.title')}</h1>
          <p>{t('notifications.subtitle')}</p>
        </div>
      </header>
      <SharingPolicy t={t} showToast={showToast} />

      <section className={css.card}>
        <h2>{t('notifications.announcement')}</h2>
        <label className={css.field}>
          <span>{t('notifications.titleField')}</span>
          <Input value={title} onChange={e => setTitle(e.target.value)} />
        </label>
        <label className={css.field}>
          <span>{t('notifications.content')}</span>
          <textarea
            className={css.textarea}
            rows={6}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
        </label>
        <p className={css.scope}>{t('notifications.sendToAllHint')}</p>
        {preview && <div className={css.preview}>
          <strong>{title.trim() || t('notifications.titleField')}</strong>
          <p>{content.trim() || t('notifications.content')}</p>
        </div>}
        <div className={css.actions}>
          <Button variant="ghost" onClick={() => setPreview(value => !value)}>{t('notifications.preview')}</Button>
          <Button variant="primary" disabled={publishing || !title.trim() || !content.trim()} onClick={publish}>{t(publishing ? 'notifications.publishing' : 'notifications.publish')}</Button>
        </div>
      </section>

      <section className={css.card}>
        <h2>{t('notifications.history')}</h2>
        <ul className={css.historyList}>
          {state.notifications.length === 0 && (
            <li className={css.empty}>{t('noData')}</li>
          )}
          {notifications.items.map(item => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span className={css.time}>{item.sentAt}</span>
                {item.revokedAt && <span className={css.time}>{t('notifications.revokedAt', { time: item.revokedAt })}</span>}
              </div>
              <div className={css.historyStatus}>
                <Tag tone="neutral">{t(item.revokedAt ? 'notifications.revoked' : 'notifications.announcement')}</Tag>
                {!item.revokedAt && <Button variant="outline" aria-label={t('notifications.revokeNamed', { title: item.title })}
                  onClick={() => setRevoking(item)}>{t('notifications.revoke')}</Button>}
                {item.revokedAt && <Button variant="outline" aria-label={t('notifications.deleteNamed', { title: item.title })}
                  onClick={() => setDeleting(item)}>{t('notifications.delete')}</Button>}
              </div>
            </li>
          ))}
        </ul>
        <Pagination page={notifications.page} total={notifications.total} onPageChange={notifications.setPage} t={t} />
      </section>

      <Modal open={revoking !== null} onClose={() => { if (!savingRevoke) setRevoking(null) }}
        closeLabel={t('close')} title={t('notifications.revoke')}
        footer={<>
          <Button variant="ghost" disabled={savingRevoke} onClick={() => setRevoking(null)}>{t('cancel')}</Button>
          <Button variant="primary" disabled={savingRevoke} onClick={revoke}>{t('notifications.confirmRevoke')}</Button>
        </>}>
        <p>{t('notifications.revokeWarning', { title: revoking?.title ?? '' })}</p>
      </Modal>
      <Modal open={deleting !== null} onClose={() => { if (!savingDelete) setDeleting(null) }}
        closeLabel={t('close')} title={t('notifications.delete')}
        footer={<>
          <Button variant="ghost" disabled={savingDelete} onClick={() => setDeleting(null)}>{t('cancel')}</Button>
          <Button variant="primary" disabled={savingDelete} onClick={deleteRecalled}>{t('notifications.confirmDelete')}</Button>
        </>}>
        <p>{t('notifications.deleteWarning', { title: deleting?.title ?? '' })}</p>
      </Modal>
    </div>
  )
}
