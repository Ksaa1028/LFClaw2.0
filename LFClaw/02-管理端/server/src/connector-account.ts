/** 员工公众号凭据的归属、配置失效与独立缓存目录。 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Database, RecordItem } from './store.ts'
import { connectorAuthentication } from './connector-auth-config.ts'
import { OAuthTokensSchema, OAuthClientInformationSchema, type OAuthTokens, type OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js'

export interface ConnectorAccount {
  employeeId: string
  connectorId: string
  configuration: string
  revision: string
  appId?: string
  appSecret?: string
  owner?: 'enterprise' | 'employee'
  values?: Record<string, string>
  tokens?: OAuthTokens
  client?: OAuthClientInformationMixed
  expiresAt?: number
  needsAuthorization?: boolean
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** 账号只能用于员工保存时的执行程序和公共环境配置。 */
export function accountConfiguration(connector: RecordItem): string {
  if (connector.authentication !== undefined) return digest(JSON.stringify([
    connector.transport, connector.endpoint, connector.command, connector.args, connector.env, connector.headers, connector.authentication,
  ]))
  return digest(JSON.stringify([connector.transport, connector.command, connector.args,
    connector.env, connector.employeeCredentials]))
}

/** 返回当前员工在此配置下的账号；旧配置或未绑定时拒绝复用。 */
export function connectorAccount(db: Database, connector: RecordItem, employeeId: string): ConnectorAccount | undefined {
  const shared = connectorAuthentication(connector).owner === 'enterprise'
  return db.connectorAccounts.find(item => (shared ? item.owner === 'enterprise' : item.owner !== 'enterprise' && item.employeeId === employeeId) && item.connectorId === connector.id
    && item.configuration === accountConfiguration(connector))
}

/** 仅员工模式公开绑定状态；不包含账号、密钥、命令或目录。 */
export function accountSummary(db: Database, connector: RecordItem, employeeId: string) {
  const authentication = connectorAuthentication(connector)
  if (authentication.type === 'none') return {}
  const account = connectorAccount(db, connector, employeeId)
  return { account: { kind: 'credentials' as const, type: authentication.type, owner: authentication.owner, configuration: accountConfiguration(connector),
    revision: account?.revision ?? '',
    fields: authentication.fields.map(({ key, label, required, secret }) => ({ key, label, required, secret })),
    configured: !!account && !account.needsAuthorization,
    status: account?.needsAuthorization ? 'reauthorize' as const : account ? 'connected' as const : 'disconnected' as const } }
}

/** 为一次员工调用合并凭据，目录按连接器、员工和绑定修订隔离。 */
export function connectorWithAccount(connector: RecordItem, account: ConnectorAccount, dataDirectory: string): RecordItem {
  const authentication = connectorAuthentication(connector)
  const values = account.values ?? { appId: account.appId ?? '', appSecret: account.appSecret ?? '' }
  const env = connector.env && typeof connector.env === 'object' && !Array.isArray(connector.env)
    ? connector.env as Record<string, unknown> : {}
  const base = typeof env.DATA_DIR === 'string' && env.DATA_DIR.trim()
    ? resolve(env.DATA_DIR) : join(dataDirectory, 'connector-data')
  const directory = join(base, digest(connector.id), digest(`${account.owner ?? 'employee'}:${account.employeeId}`), digest(account.revision))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const headers = connector.headers && typeof connector.headers === 'object' && !Array.isArray(connector.headers)
    ? connector.headers as Record<string, unknown> : {}
  const runtimeEnv = { ...env }, runtimeHeaders = { ...headers }
  for (const field of authentication.fields) {
    const target = field.target === 'env' ? runtimeEnv : runtimeHeaders
    for (const key of Object.keys(target)) if (key.toLowerCase() === field.name.toLowerCase()) delete target[key]
    if (values[field.key]) target[field.name] = field.prefix + values[field.key]
  }
  return { ...connector, env: { ...runtimeEnv, DATA_DIR: directory,
    ...(authentication.owner === 'employee' ? { HOME: directory, USERPROFILE: directory,
      APPDATA: join(directory, 'AppData', 'Roaming'), LOCALAPPDATA: join(directory, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(directory, '.config'), XDG_CACHE_HOME: join(directory, '.cache') } : {}),
  }, headers: runtimeHeaders }
}

/** 校验磁盘和备份里的私有账号集合。 */
export function validConnectorAccounts(value: unknown): value is ConnectorAccount[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  return value.every((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const entry = item as Record<string, unknown>
    if (!['employeeId', 'connectorId', 'configuration', 'revision'].every(key =>
      typeof entry[key] === 'string' && !!entry[key] && (entry[key] as string).length <= 4096)
      || Object.keys(entry).some(key => !['employeeId', 'connectorId', 'configuration', 'revision', 'appId', 'appSecret',
        'owner', 'values', 'tokens', 'client', 'expiresAt', 'needsAuthorization'].includes(key))
      || !/^[a-f0-9]{64}$/.test(String(entry.configuration))) return false
    if (entry.owner !== undefined && !['enterprise', 'employee'].includes(String(entry.owner))) return false
    for (const key of ['appId', 'appSecret']) if (entry[key] !== undefined && (typeof entry[key] !== 'string' || (entry[key] as string).length > 4096)) return false
    if (entry.values !== undefined && (!entry.values || typeof entry.values !== 'object' || Array.isArray(entry.values)
      || Object.keys(entry.values).length > 20 || !Object.values(entry.values).every(value => typeof value === 'string' && value.length <= 4096))) return false
    if (entry.tokens !== undefined && !OAuthTokensSchema.safeParse(entry.tokens).success) return false
    if (entry.client !== undefined && !OAuthClientInformationSchema.safeParse(entry.client).success) return false
    if (entry.expiresAt !== undefined && (typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt))) return false
    if (entry.needsAuthorization !== undefined && typeof entry.needsAuthorization !== 'boolean') return false
    if (!entry.values && !entry.tokens && !(entry.appId && entry.appSecret)) return false
    const key = JSON.stringify([entry.owner ?? 'employee', entry.employeeId, entry.connectorId])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}
