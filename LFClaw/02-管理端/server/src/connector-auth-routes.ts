/** 通用认证接口；管理员和员工分别操作自己的凭据，OAuth 回调不携带业务令牌。 */
import { randomUUID } from 'node:crypto'
import type { Express, Request } from 'express'
import { accountConfiguration, accountSummary, connectorAccount, connectorWithAccount, type ConnectorAccount } from './connector-account.ts'
import { connectorAuthentication } from './connector-auth-config.ts'
import { ConnectorOAuth } from './connector-oauth.ts'
import { authorizationFor } from './authorization.ts'
import { bearerToken } from './auth.ts'
import { guardConnectorAccess } from './connector-access.ts'
import type { ServerOptions } from './app.ts'
import type { RecordItem } from './store.ts'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

export interface ConnectorAuthRuntime {
  oauth: ConnectorOAuth
  discover: (connector: RecordItem, signal?: AbortSignal, provider?: OAuthClientProvider) => Promise<{ name: string; description?: string }[]>
  employee: (req: Request) => RecordItem | null
}

/** 挂载受身份约束的凭据操作与一次性 OAuth 回调。 */
export function mountConnectorAuthentication(app: Express, options: ServerOptions, runtime: ConnectorAuthRuntime): void {
  const employee = runtime.employee
  const principal = (req: Request, connector: RecordItem, admin: boolean) => {
    const session = options.auth.resolve(bearerToken(req))
    const mode = connectorAuthentication(connector)
    if (admin) return session?.principal === 'admin' && mode.owner === 'enterprise' && connector.enabled === true ? '$enterprise' : null
    const current = employee(req)
    return mode.owner === 'employee' && current && authorizationFor(connector, current, options.store.read()).allowed ? current.id : null
  }
  const commit = (connector: RecordItem, account: ConnectorAccount, tools: { name: string; description?: string }[]) => {
    options.store.update(db => {
      db.connectorAccounts = db.connectorAccounts.filter(item => !(item.connectorId === connector.id
        && (item.owner ?? 'employee') === (account.owner ?? 'employee') && item.employeeId === account.employeeId))
      db.connectorAccounts.push(account)
      const target = db.connectors.find(item => item.id === connector.id)
      if (!target) throw new Error('连接器已删除')
      const existing = Array.isArray(target.tools) ? target.tools : []
      const names = new Set(existing.map((item: Record<string, unknown>) => item.name))
      target.tools = [...existing, ...tools.filter(tool => !names.has(tool.name)).map(tool =>
        ({ id: tool.name, name: tool.name, description: tool.description ?? '', allowed: connector.mallDataPermissions !== true }))]
    })
  }
  for (const admin of [false, true]) {
    const path = `/api/${admin ? 'admin' : 'employee'}/connectors/:id/credentials`
    app.get(path, (req, res) => {
      const connector = options.store.read().connectors.find(item => item.id === req.params.id)
      if (!connector || !principal(req, connector, admin)) { res.status(403).json({ code: 'CONNECTOR_FORBIDDEN' }); return }
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ...accountSummary(options.store.read(), connector, principal(req, connector, admin)!),
        ...(admin && connectorAuthentication(connector).type === 'oauth' ? { callbackUrl: runtime.oauth.callbackUrl } : {}) })
    })
    app.post(path, async (req, res) => {
      const connector = options.store.read().connectors.find(item => item.id === req.params.id)
      const ownerId = connector && principal(req, connector, admin)
      if (!connector || !ownerId) { res.status(403).json({ code: 'CONNECTOR_FORBIDDEN', message: '此账号不可操作' }); return }
      const mode = connectorAuthentication(connector)
      if (mode.type === 'none') { res.status(400).json({ code: 'ACCOUNT_NOT_SUPPORTED', message: '此连接器无需配置账号' }); return }
      const body: unknown = req.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('operation' in body)) {
        res.status(400).json({ code: 'ACCOUNT_INVALID', message: '账号请求格式无效' }); return
      }
      if (!('configuration' in body) || body.configuration !== accountConfiguration(connector)) {
        res.status(409).json({ code: 'CONNECTOR_ACCESS_CHANGED', message: '连接器配置已变化，请刷新后重新连接' }); return
      }
      const check = () => {
        const current = options.store.read().connectors.find(item => item.id === connector.id)
        if (!current || principal(req, current, admin) !== ownerId || accountConfiguration(current) !== accountConfiguration(connector)) {
          throw new Error('连接器授权或配置已变化')
        }
      }
      if (body.operation === 'remove' && Object.keys(body).length === 2) {
        runtime.oauth.cancel(connector, ownerId)
        options.store.update(db => {
          db.connectorAccounts = db.connectorAccounts.filter(item => !(item.connectorId === connector.id
            && (item.owner ?? 'employee') === mode.owner && item.employeeId === ownerId))
        })
        res.json({ configured: false }); return
      }
      if (!admin && mode.type === 'oauth' && body.operation === 'oauth-loopback'
        && Object.keys(body).length === 3 && 'callbackUrl' in body && typeof body.callbackUrl === 'string') {
        try {
          res.setHeader('Cache-Control', 'no-store')
          res.json(await runtime.oauth.start(connector, ownerId, check, body.callbackUrl))
        } catch (error) {
          console.error('连接器本机 OAuth 开始失败:', error instanceof Error ? error.name : 'unknown')
          res.status(502).json({ code: 'OAUTH_START_FAILED' })
        }
        return
      }
      if (!admin && mode.type === 'oauth' && body.operation === 'oauth-complete'
        && Object.keys(body).length === 4 && 'state' in body && typeof body.state === 'string' && body.state.length <= 128
        && 'code' in body && typeof body.code === 'string' && body.code.length <= 8192) {
        const guard = guardConnectorAccess(options.store, () => employee(req), connector.id, res)
        try {
          const pending = await runtime.oauth.complete(body.state, body.code, { connectorId: connector.id, ownerId })
          const tools = await runtime.discover(pending.connector, guard.signal, pending.provider)
          check(); pending.check(); guard.assertCurrent()
          commit(pending.connector, pending.account, tools)
          runtime.oauth.cancel(pending.connector, ownerId)
          res.setHeader('Cache-Control', 'no-store'); res.json({ configured: true })
        } catch (error) {
          console.error('连接器本机 OAuth 完成失败:', error instanceof Error ? error.name : 'unknown')
          res.status(400).json({ code: 'OAUTH_COMPLETION_FAILED' })
        } finally { guard.dispose() }
        return
      }
      if (body.operation === 'oauth' && Object.keys(body).length === 2 && mode.type === 'oauth') {
        if (!runtime.oauth.callbackUrl) {
          res.status(503).json({ code: 'OAUTH_CALLBACK_UNAVAILABLE',
            message: '服务器未配置 OAuth 回调地址，请管理员配置可访问的 HTTPS 回调后重试。' })
          return
        }
        try { res.setHeader('Cache-Control', 'no-store'); res.json(await runtime.oauth.start(connector, ownerId, check)) }
        catch (error) {
          console.error('连接器 OAuth 开始失败:', error instanceof Error ? error.name : 'unknown')
          res.status(502).json({ code: 'OAUTH_START_FAILED', message: '无法开始授权。请检查 MCP 地址、OAuth 支持和回调地址；不支持自动注册的服务须填写预注册 Client ID 与签发者地址。' })
        }
        return
      }
      if (body.operation !== 'save' || Object.keys(body).length !== 3 || !('values' in body)
        || !body.values || typeof body.values !== 'object' || Array.isArray(body.values) || mode.type === 'oauth') {
        res.status(400).json({ code: 'ACCOUNT_INVALID', message: '账号请求格式无效' }); return
      }
      const values = body.values as Record<string, unknown>
      if (Object.entries(values).some(([key, value]) => !mode.fields.some(field => field.key === key)
        || typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value))) {
        res.status(400).json({ code: 'ACCOUNT_INVALID', message: '凭据字段无效' }); return
      }
      const previous = connectorAccount(options.store.read(), connector, ownerId)
      const previousValues: Record<string, string | undefined> = previous?.values ?? { appId: previous?.appId, appSecret: previous?.appSecret }
      const changedIdentity = mode.fields.some(field => !field.secret && values[field.key]
        && values[field.key] !== previousValues[field.key])
      const resolved = Object.fromEntries(mode.fields.map(field => [field.key, values[field.key]
        || (!changedIdentity || !field.secret ? previousValues[field.key] : '') || ''])) as Record<string, string>
      if (mode.fields.some(field => field.required && !resolved[field.key])) {
        res.status(400).json({ code: 'ACCOUNT_INVALID', message: '请填写必填凭据；更换账号时须重新填写密钥' }); return
      }
      const account: ConnectorAccount = { employeeId: ownerId, connectorId: connector.id, owner: mode.owner,
        configuration: accountConfiguration(connector), revision: randomUUID(), values: resolved }
      const originalRevision = previous?.revision
      const authorizationRevision = runtime.oauth.revision(connector, ownerId)
      const guard = !admin ? guardConnectorAccess(options.store, () => employee(req), connector.id, res) : undefined
      try {
        const tools = await runtime.discover(connectorWithAccount(connector, account, options.dataDirectory), guard?.signal)
        check(); guard?.assertCurrent()
        if (connectorAccount(options.store.read(), connector, ownerId)?.revision !== originalRevision
          || runtime.oauth.revision(connector, ownerId) !== authorizationRevision) {
          res.status(409).json({ code: 'CONNECTOR_ACCESS_CHANGED', message: '账号已变化，请重新保存' }); return
        }
        runtime.oauth.cancel(connector, ownerId); commit(connector, account, tools)
        res.setHeader('Cache-Control', 'no-store'); res.json({ configured: true })
      } catch (error) {
        console.error('连接器凭据检查失败:', error instanceof Error ? error.name : 'unknown')
        res.status(502).json({ code: 'ACCOUNT_CONNECTION_FAILED', message: '连接检查失败，请检查凭据、网络和 MCP 配置；原账号已保留' })
      } finally { guard?.dispose() }
    })
  }
  app.get('/api/connectors/oauth/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'")
    if (typeof req.query.state !== 'string' || req.query.state.length > 128
      || typeof req.query.code !== 'string' || req.query.error) {
      res.status(400).type('text').send('授权未完成。请返回 LFClaw 重新连接。'); return
    }
    try {
      const pending = await runtime.oauth.complete(req.query.state, req.query.code)
      const tools = await runtime.discover(pending.connector, undefined, pending.provider)
      pending.check()
      commit(pending.connector, pending.account, tools)
      runtime.oauth.cancel(pending.connector, pending.account.employeeId)
      res.type('text').send('授权成功，工具已就绪。请返回 LFClaw，关闭此页面即可。')
    } catch (error) {
      console.error('连接器 OAuth 回调失败:', error instanceof Error ? error.name : 'unknown')
      res.status(400).type('text').send('授权或连接检查失败，可能已过期、配置已变化或服务不可达。请返回 LFClaw 重新连接。')
    }
  })
}
