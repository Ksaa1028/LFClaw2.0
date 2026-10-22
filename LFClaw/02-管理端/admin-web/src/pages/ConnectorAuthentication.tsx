import type { ReactNode } from 'react'
import { Button, Input, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Connector, ConnectorAuthentication } from '../mock/data.ts'
import type { Translate } from '../locales/index.ts'
import css from './ConnectorsPage.module.css'

export function authenticationFor(connector: Partial<Connector>): ConnectorAuthentication {
  return connector.authentication ?? (connector.employeeCredentials === 'wechat-mp'
    ? { type: 'fields', owner: 'employee', fields: [
      { key: 'appId', label: 'AppID', target: 'env', name: 'WECHAT_APP_ID', prefix: '', required: true, secret: false },
      { key: 'appSecret', label: 'AppSecret', target: 'env', name: 'WECHAT_APP_SECRET', prefix: '', required: true, secret: true },
    ] } : { type: 'none', owner: 'enterprise', fields: [] })
}

export function ConnectorAuthenticationEditor({ connector, onChange, t }: {
  connector: Partial<Connector>; onChange: (value: ConnectorAuthentication) => void; t: Translate
}): ReactNode {
  const value = authenticationFor(connector)
  const field = (index: number, update: Partial<ConnectorAuthentication['fields'][number]>) =>
    onChange({ ...value, fields: value.fields.map((item, current) => current === index ? { ...item, ...update } : item) })
  return <div className={css.toolsSection}>
    <label className={css.field}><span>{t('connectors.authType')}</span>
      <select value={value.type} disabled={connector.mallDataPermissions} onChange={event => {
        const type = event.target.value as ConnectorAuthentication['type']
        onChange({ type, owner: value.owner, fields: type === 'fields' || type === 'token' ? [{
          key: 'token', label: 'API Token', target: connector.transport === 'stdio' ? 'env' : 'header',
          name: connector.transport === 'stdio' ? 'API_KEY' : 'Authorization',
          prefix: connector.transport === 'stdio' ? '' : 'Bearer ', required: true, secret: true,
        }] : [] })
      }}>
        <option value="none">{t('connectors.authNone')}</option>
        <option value="oauth" disabled={connector.transport === 'stdio'}>{t('connectors.authOAuth')}</option>
        <option value="token">{t('connectors.authToken')}</option>
        <option value="fields">{t('connectors.authFields')}</option>
      </select>
    </label>
    {value.type !== 'none' && <>
      <label className={css.field}><span>{t('connectors.accountMode')}</span><select value={value.owner}
        onChange={event => onChange({ ...value, owner: event.target.value as ConnectorAuthentication['owner'] })}>
        <option value="enterprise">{t('connectors.sharedAccount')}</option>
        <option value="employee">{t('connectors.employeeAccount')}</option>
      </select></label>
      <span className={css.muted}>{t('connectors.authSetupHint')}</span>
    </>}
    {value.type === 'oauth' && <>
      <span className={css.muted}>{t('connectors.oauthSetupHint')}</span>
      <label className={css.field}><span>{t('connectors.oauthClientId')}</span>
        <Input value={value.clientId ?? ''} onChange={event => onChange({ ...value, clientId: event.target.value })} /></label>
      <label className={css.field}><span>{t('connectors.oauthIssuer')}</span>
        <Input value={value.issuer ?? ''} onChange={event => onChange({ ...value, issuer: event.target.value })} /></label>
      <label className={css.field}><span>{t('connectors.oauthScopes')}</span>
        <Input value={value.scopes ?? ''} onChange={event => onChange({ ...value, scopes: event.target.value })} /></label>
    </>}
    {value.fields.map((item, index) => <div className={css.toolsSection} key={index}>
      <label className={css.field}><span>{t('connectors.credentialKey')}</span>
        <Input value={item.key} onChange={event => field(index, { key: event.target.value })} /></label>
      <label className={css.field}><span>{t('connectors.credentialLabel')}</span>
        <Input value={item.label} onChange={event => field(index, { label: event.target.value })} /></label>
      <label className={css.field}><span>{t(connector.transport === 'stdio' ? 'connectors.envName' : 'connectors.headerName')}</span>
        <Input value={item.name} onChange={event => field(index, { name: event.target.value,
          target: connector.transport === 'stdio' ? 'env' : 'header' })} /></label>
      <label className={css.field}><span>{t('connectors.credentialPrefix')}</span>
        <Input value={item.prefix} onChange={event => field(index, { prefix: event.target.value })} /></label>
      <Checkbox checked={item.required} label={t('connectors.credentialRequired')} onChange={required => field(index, { required })} />
      <Checkbox checked={item.secret} label={t('connectors.credentialSecret')} onChange={secret => field(index, { secret })} />
      {value.type === 'fields' && <Button size="sm" variant="ghost" onClick={() => onChange({ ...value,
        fields: value.fields.filter((_, current) => current !== index) })}>{t('delete')}</Button>}
    </div>)}
    {value.type === 'fields' && <Button size="sm" variant="outline" disabled={value.fields.length >= 20}
      onClick={() => onChange({ ...value, fields: [...value.fields, { key: `field${value.fields.length + 1}`, label: '',
        target: connector.transport === 'stdio' ? 'env' : 'header', name: '', prefix: '', required: true, secret: true }] })}>
      {t('connectors.addCredential')}</Button>}
  </div>
}
