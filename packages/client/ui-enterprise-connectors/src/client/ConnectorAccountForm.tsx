/** Employee-owned WeChat account form; submitted secrets are never read back. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectorCenterKey } from './locales.ts'
import css from './ConnectorsPage.module.css'
import type { ConnectorSummary } from '../catalog.ts'

/** Configure the signed-in employee's account for one enterprise connector.
 * @param props - Connector identity, binding status and parent feedback.
 * @returns Private credential inputs and save/remove actions.
 */
export function ConnectorAccountForm({
  id,
  configured,
  account,
  t,
  onChanged,
}: {
  id: string
  configured: boolean
  account?: ConnectorSummary['account']
  t: TranslateNS<'connectorCenter'>
  onChanged: (message: string) => void
}): ReactNode {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [authorizationUrl, setAuthorizationUrl] = useState('')
  const generic = account?.kind === 'credentials' ? account : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ConnectorCenterKey | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit(method: 'PUT' | 'DELETE' | 'OAUTH') {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/lfclaw/${generic ? 'connector-credentials' : 'connector-account'}?id=${encodeURIComponent(id)}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            generic
              ? {
                operation: method === 'OAUTH' ? 'oauth' : method === 'PUT' ? 'save' : 'remove',
                configuration: generic.configuration,
                ...(method === 'PUT' ? { values } : {}),
              }
              : method === 'PUT'
                ? { operation: 'save', appId, appSecret }
                : { operation: 'remove' },
          ),
        },
      )
      if (controller.signal.aborted) return
      if (!response.ok) {
        if (response.status === 503 || response.status === 400) {
          const failure: unknown = await response.json()
          if (controller.signal.aborted) return
          if (
            failure !== null &&
            typeof failure === 'object' &&
            'code' in failure &&
            failure.code === 'OAUTH_CALLBACK_UNAVAILABLE'
          ) {
            setError('oauthCallbackUnavailable')
            return
          }
          if (
            failure !== null &&
            typeof failure === 'object' &&
            'code' in failure &&
            failure.code === 'OAUTH_SERVER_UPDATE_REQUIRED'
          ) {
            setError('oauthServerUpdateRequired')
            return
          }
        }
        setError(
          response.status === 400
            ? 'accountInvalid'
            : response.status === 409
              ? 'accountChanged'
              : response.status === 401 || response.status === 403
                ? 'accountForbidden'
                : 'accountFailed',
        )
        return
      }
      if (method === 'OAUTH') {
        const result: unknown = await response.json()
        if (
          !result ||
          typeof result !== 'object' ||
          !('authorizationUrl' in result) ||
          typeof result.authorizationUrl !== 'string'
        ) {
          setError('accountFailed')
          return
        }
        const url = new URL(result.authorizationUrl)
        if (
          url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        ) {
          setError('accountFailed')
          return
        }
        setAuthorizationUrl(url.href)
        window.open(url.href, '_blank', 'noopener,noreferrer')
        return
      }
      setAppId('')
      setAppSecret('')
      setValues({})
      setAuthorizationUrl('')
      onChanged(t(method === 'PUT' ? 'accountSaved' : 'accountRemoved'))
    } catch {
      if (!controller.signal.aborted) setError('accountFailed')
    } finally {
      if (pending.current === controller) pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  if (generic?.owner === 'enterprise')
    return <p className={css.toolEmpty}>{t(configured ? 'enterpriseAccountConnected' : 'enterpriseAccountRequired')}</p>
  return (
    <div className={css.form}>
      <h3>{t('accountTitle')}</h3>
      <p className={css.toolEmpty}>{t(configured ? 'accountConfiguredHint' : 'accountRequiredHint')}</p>
      {generic?.status === 'reauthorize' && <p role="status">{t('accountReauthorize')}</p>}
      {generic ? (
        generic.fields.map(field => (
          <label key={field.key}>
            <span>
              {field.label}
              {field.required ? ' *' : ''}
            </span>
            <Input
              type={field.secret ? 'password' : 'text'}
              autoComplete={field.secret ? 'new-password' : 'off'}
              value={values[field.key] ?? ''}
              disabled={busy}
              onChange={(event) => {
                setValues(prior => ({ ...prior, [field.key]: event.target.value }))
              }}
            />
          </label>
        ))
      ) : (
        <>
          <label>
            <span>{t('wechatAppId')}</span>
            <Input
              autoComplete="off"
              value={appId}
              disabled={busy}
              onChange={(event) => {
                setAppId(event.target.value)
              }}
            />
          </label>
          <label>
            <span>{t('wechatAppSecret')}</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={appSecret}
              disabled={busy}
              onChange={(event) => {
                setAppSecret(event.target.value)
              }}
            />
          </label>
        </>
      )}
      {authorizationUrl && (
        <p role="status">
          {t('oauthWaiting')}{' '}
          <a href={authorizationUrl} target="_blank" rel="noreferrer">
            {t('oauthOpen')}
          </a>
        </p>
      )}
      {error && (
        <p className={css.notice} role="alert">
          {t(error)}
        </p>
      )}
      <div className={css.actions}>
        <Button
          disabled={
            busy ||
            (!configured &&
              (generic
                ? generic.fields.some(field => field.required && !values[field.key]?.trim())
                : !appId.trim() || !appSecret.trim()))
          }
          onClick={() => {
            void submit(generic?.type === 'oauth' ? 'OAUTH' : 'PUT')
          }}
        >
          {t(busy ? 'accountSaving' : generic?.type === 'oauth' ? 'oauthConnect' : 'accountSave')}
        </Button>
        {(configured || authorizationUrl || generic?.status === 'reauthorize') && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void submit('DELETE')
            }}
          >
            {t('accountRemove')}
          </Button>
        )}
      </div>
    </div>
  )
}
