import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { AdminModal as Modal } from '../components/AdminModal.tsx'
import { request } from '../api.ts'
import type { Connector } from '../mock/data.ts'
import type { Translate } from '../locales/index.ts'
import { authenticationFor } from './ConnectorAuthentication.tsx'
import css from './ConnectorsPage.module.css'

export function ConnectorAccountDialog({ connector, t, onClose, onChanged }: {
  connector: Connector; t: Translate; onClose: () => void; onChanged: () => void
}): ReactNode {
  const mode = authenticationFor(connector)
  const [values, setValues] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState(connector.account?.configured === true)
  const [configuration, setConfiguration] = useState(connector.account?.configuration ?? '')
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [error, setError] = useState('')
  const [configurationChanged, setConfigurationChanged] = useState(false)
  const path = `/admin/connectors/${encodeURIComponent(connector.id)}/credentials`
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => {
      void request<{ account: { configured: boolean; configuration: string }; callbackUrl?: string }>(path, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) {
          setConfigured(result.account.configured)
          setCallbackUrl(result.callbackUrl ?? '')
          setConfiguration(prior => {
            if (prior && prior !== result.account.configuration) {
              setValues({}); setUrl(''); setConfigurationChanged(true); setError(t('connectors.accountConfigurationChanged'))
            }
            return result.account.configuration
          })
          if (result.account.configured) setUrl('')
        } })
        .catch((error: unknown) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t('connectors.testFailed')) })
    }
    refresh(); window.addEventListener('focus', refresh)
    return () => { controller.abort(); window.removeEventListener('focus', refresh) }
  }, [path, t])
  async function submit(operation: 'save' | 'oauth' | 'remove') {
    if (busy || configurationChanged) return
    setBusy(true); setError('')
    try {
      const result = await request<{ configured?: boolean; authorizationUrl?: string }>(path, {
        method: 'POST', body: JSON.stringify({ operation, configuration, ...(operation === 'save' ? { values } : {}) }),
      })
      if (result.authorizationUrl) {
        const address = new URL(result.authorizationUrl)
        if (address.protocol !== 'https:' && !(address.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname))) throw new Error(t('connectors.testFailed'))
        setUrl(address.href); window.open(address.href, '_blank', 'noopener,noreferrer')
      } else {
        setConfigured(result.configured === true); setValues({}); setUrl(''); onChanged()
      }
    } catch (error) { setError(error instanceof Error ? error.message : t('connectors.testFailed')) }
    finally { setBusy(false) }
  }
  return <Modal open title={`${connector.name} · ${t('connectors.accountConnect')}`} onClose={() => { if (!busy) onClose() }}
    closeLabel={t('close')} footer={<>
      {(configured || url) && <Button variant="outline" disabled={busy || configurationChanged} onClick={() => { void submit('remove') }}>{t('connectors.accountDisconnect')}</Button>}
      <Button disabled={busy || !configuration || configurationChanged} onClick={() => { void submit(mode.type === 'oauth' ? 'oauth' : 'save') }}>
        {t(busy ? 'connectors.accountBusy' : mode.type === 'oauth' ? 'connectors.oauthConnect' : 'connectors.accountSave')}
      </Button>
    </>}>
    <div className={css.form}>
      <p>{t(configured ? 'connectors.accountConnected' : 'connectors.accountMissing')}</p>
      {mode.type === 'oauth' && <label className={css.field}><span>{t('connectors.oauthCallback')}</span><Input readOnly value={callbackUrl} /></label>}
      {mode.type !== 'oauth' && <p className={css.muted}>{t('connectors.credentialKeepHint')}</p>}
      {mode.fields.map(field => <label className={css.field} key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span>
        <Input value={values[field.key] ?? ''} disabled={busy} type={field.secret ? 'password' : 'text'} autoComplete="off"
          onChange={event => setValues(prior => ({ ...prior, [field.key]: event.target.value }))} /></label>)}
      {url && <p>{t('connectors.oauthWaiting')} <a href={url} target="_blank" rel="noreferrer">{t('connectors.oauthConnect')}</a></p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>
}
