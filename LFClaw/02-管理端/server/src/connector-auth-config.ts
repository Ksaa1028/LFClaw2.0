/** 连接器认证配置；字段描述可公开，值只存放在私有账号集合。 */
import type { RecordItem } from './store.ts'

export interface CredentialField {
  key: string
  label: string
  target: 'header' | 'env'
  name: string
  prefix: string
  required: boolean
  secret: boolean
}
export interface ConnectorAuthentication {
  type: 'none' | 'token' | 'fields' | 'oauth'
  owner: 'enterprise' | 'employee'
  fields: CredentialField[]
  clientId?: string
  issuer?: string
  scopes?: string
}

const wechatFields: CredentialField[] = [
  { key: 'appId', label: 'AppID', target: 'env', name: 'WECHAT_APP_ID', prefix: '', required: true, secret: false },
  { key: 'appSecret', label: 'AppSecret', target: 'env', name: 'WECHAT_APP_SECRET', prefix: '', required: true, secret: true },
]
/** 旧公众号配置继续使用原员工绑定，不在读取时改写数据库。 */
export function connectorAuthentication(connector: RecordItem): ConnectorAuthentication {
  if (connector.authentication !== undefined) {
    if (!validAuthentication(connector.authentication, connector.transport)) throw new Error('连接器认证配置无效')
    return connector.authentication
  }
  return connector.employeeCredentials === 'wechat-mp'
    ? { type: 'fields', owner: 'employee', fields: wechatFields }
    : { type: 'none', owner: 'enterprise', fields: [] }
}

/** 校验管理员提交的认证方式、凭据映射和预注册 OAuth 元数据。 */
export function validAuthentication(value: unknown, transport: unknown): value is ConnectorAuthentication {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (!['none', 'token', 'fields', 'oauth'].includes(String(input.type))
    || !['enterprise', 'employee'].includes(String(input.owner))
    || Object.keys(input).some(key => !['type', 'owner', 'fields', 'clientId', 'issuer', 'scopes'].includes(key))
    || !Array.isArray(input.fields) || input.fields.length > 20) return false
  if (input.type === 'oauth' && transport === 'stdio') return false
  if ((input.type === 'none' || input.type === 'oauth') && input.fields.length !== 0) return false
  if (input.type === 'token' && input.fields.length !== 1 || input.type === 'fields' && !input.fields.length) return false
  for (const name of ['clientId', 'issuer', 'scopes']) {
    if (input[name] !== undefined && (typeof input[name] !== 'string' || (input[name] as string).length > 2048
      || /[\0\r\n]/.test(input[name] as string))) return false
  }
  if (input.clientId && !input.issuer) return false
  if (input.issuer) {
    try { const url = new URL(String(input.issuer)); if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false }
    catch { return false }
  }
  const keys = new Set<string>(), destinations = new Set<string>()
  return input.fields.every((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const f = value as Record<string, unknown>
    if (Object.keys(f).length !== 7 || typeof f.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f.key)
      || keys.has(f.key) || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 100
      || typeof f.name !== 'string' || typeof f.prefix !== 'string' || f.prefix.length > 100 || /[\0\r\n]/.test(f.prefix)
      || typeof f.required !== 'boolean' || typeof f.secret !== 'boolean') return false
    if (f.target === 'env') {
      if (transport !== 'stdio' || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(f.name)
        || ['DATA_DIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'].includes(f.name.toUpperCase())) return false
    } else if (f.target === 'header') {
      const lower = f.name.toLowerCase()
      if (transport === 'stdio' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(f.name)
        || ['host', 'content-length', 'cookie', 'x-lfclaw-permission-assertion'].includes(lower) || lower.startsWith('mcp-')) return false
    } else return false
    const destination = `${f.target}:${f.name.toLowerCase()}`
    if (destinations.has(destination)) return false
    keys.add(f.key); destinations.add(destination); return true
  })
}
