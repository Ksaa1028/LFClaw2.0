import { modelCapacity, modelThinkingOption, validModelCapacity, validModelThinkingOption } from './model-capacity.ts'
import { mountSessionSharing } from './session-sharing.ts'
import { once } from 'node:events'
import { dashboardData } from './dashboard.ts'
import { parseUsageReportQuery, usageReport } from './usage-report.ts'
import { resourceOperationSummary } from './operation-summary.ts'
import { accountConfiguration, accountSummary, connectorAccount, connectorWithAccount, type ConnectorAccount } from './connector-account.ts'
import { connectorAuthentication, validAuthentication } from './connector-auth-config.ts'
import { ConnectorOAuth, ConnectorAuthorizationRequired, validOAuthUrl } from './connector-oauth.ts'
import { mountConnectorAuthentication } from './connector-auth-routes.ts'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { validBranding } from './branding.ts'
import { modelResponseDeadline, validGatewayMessages, gatewayOptions, completionEvents, forwardCompletionStream } from './model-gateway.ts'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import cors from 'cors'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, createReadStream, writeFileSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import multer from 'multer'
import { pinyin } from 'pinyin-pro'
import { skillDescription, type Limits } from './skill-archive.ts'
import { createBackup, publicBackupArchive, restoreBackup } from './backup.ts'
import { discoverMcpTools, permissionsForEmployee, remoteMcpEndpoint, usesMallDataPermissions, validMallPermissions, withMcp, type McpConnection } from './mcp.ts'
import { readSystemStatus } from './status.ts'
import { authorizationFor } from './authorization.ts'
import { connectorTools, employeeConnectors, mallArgumentsAllowed, mallPublicResult, mallPublicSchema, resolveMallCalls, restrictMallQuery } from './mcp-policy.ts'
import { ConnectorAccessChanged, guardConnectorAccess, sendConnectorCatalog } from './connector-access.ts'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { callBailianExpert, callDifyExpert, validExpert } from './expert.ts'
import { callWeKnoraExpert, WeKnoraSessionError, WeKnoraTimeoutError } from './weknora.ts'
import { resolvePersonalTeam, PersonalTeamError } from './personal-team.ts'
import { ExpertImportError, resolveExpertImport } from './expert-import.ts'
import { validPersonalExpert, expertCapabilities, expertRevision, personalReferencesAllowed, prepareExpert, validExpertCapabilities } from './expert-definition.ts'
import { AuthLimit } from './auth-limit.ts'
import { costOf, pricingOf, validPricing } from './pricing.ts'
import { AuthService, activationHash, bearerToken, requireAdmin } from './auth.ts'
import { JsonStore, StoreError, isCollectionName, isMutableCollectionName, isRecordItem, type CollectionName, type Database, type RecordItem } from './store.ts'

export interface ServerOptions {
  /** 技能上传、下载及历史版本读取共用的部署限制。 */
  skillArchiveLimits: Limits
  signal?: AbortSignal
  oauthCallbackUrl?: string
  oauthFlowTtlMs?: number
  store: JsonStore
  auth: AuthService
  skillsDirectory: string
  dataDirectory: string
  allowedOrigin: string
  mcpTimeoutMs?: number | undefined
  modelTimeoutMs: number
  expertTimeoutMs?: number | undefined
  authWindowMs: number
  loginMaxFailures: number
  activationMaxFailures: number
}
const oauthServices = new WeakMap<ServerOptions, ConnectorOAuth>()
const runtimeOAuth = new WeakMap<RecordItem, { provider: OAuthClientProvider; fetch: typeof fetch }>()

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function publicModel(item: RecordItem): RecordItem {
  const { apiKey, ...visible } = item
  return { ...visible, ...modelCapacity(item), hasApiKey: typeof apiKey === 'string' && apiKey.length > 0, apiKey: '' }
}

function publicConnector(item: RecordItem): RecordItem {
  const { authMode: _legacyAuthMode, ...visible } = item
  return { ...visible, mallDataPermissions: usesMallDataPermissions(item),
    headers: Object.fromEntries(Object.keys(connectorHeaders(item)).map(name => [name, ''])),
    env: Object.fromEntries(Object.keys(connectorEnvironment(item)).map(name => [name, ''])) }
}

function publicDatabase(db: ReturnType<JsonStore['read']>) {
  const { personalExperts: _private, connectorAccounts: _accounts, modelUsage: _usage, ...publicData } = db
  return { ...publicData, ...dashboardData(db), models: db.models.map(publicModel), connectors: db.connectors.map(item => ({
    ...publicConnector(item), ...accountSummary(db, item, '$enterprise'),
  })), experts: db.experts.map(item => {
    const config = bodyRecord(item.externalConfig)
    return config ? { ...item, externalConfig: { ...config, apiKey: '' }, hasApiKey: !!config.apiKey } : item
  }) }
}

function issueActivationCode(name: string): string {
  const romanized = pinyin(name, { toneType: 'none', type: 'array', mode: 'surname', v: true })
    .join('').replace(/[^a-z]/gi, '').toUpperCase()
  if (!romanized || romanized.length > 64) throw new Error('员工姓名无法生成有效激活码')
  return `LF-${romanized}-${randomBytes(4).toString('hex').toUpperCase()}`
}

function recordOperation(db: Database, type: string, object: string, change: string): void {
  db.operationLogs.unshift({ id: randomUUID(), time: new Date().toISOString(), type, object, change, operator: 'admin' })
}

function validConnectorScope(input: RecordItem, db: Database): boolean {
  if ((input.scope === 'all' || input.scope === 'none')) return Array.isArray(input.scopeTarget) && input.scopeTarget.length === 0
  if (input.scope !== 'department' && input.scope !== 'employee') return false
  if (!Array.isArray(input.scopeTarget) || input.scopeTarget.length === 0
    || !input.scopeTarget.every((id): id is string => typeof id === 'string')
    || new Set(input.scopeTarget).size !== input.scopeTarget.length) return false
  const candidates = input.scope === 'department' ? db.departments : db.employees
  return input.scopeTarget.every(id => candidates.some(item => item.id === id))
}

function validConnectorPresentation(input: RecordItem): boolean {
  return (input.showToolsInClient === undefined || typeof input.showToolsInClient === 'boolean')
    && (input.showInClient === undefined || typeof input.showInClient === 'boolean')
}

function validImageIcon(icon: unknown): boolean {
  if (icon === undefined || icon === '') return true
  if (typeof icon !== 'string' || icon.length > 2800000) return false
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(icon)
  if (!match) return false
  const bytes = Buffer.from(match[2]!, 'base64')
  if (bytes.length > 2 * 1024 * 1024) return false
  return match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
}

function validSkillPresentation(input: RecordItem): boolean {
  return (input.version === undefined || typeof input.version === 'string' && !!input.version.trim() && input.version.length <= 64)
    && validImageIcon(input.icon)
}

function connectorTransport(item: RecordItem): McpConnection['transport'] {
  if (item.transport === 'stdio') return 'stdio'
  return item.transport === 'streamable-http' ? 'streamable-http' : 'sse'
}

function connectorHeaders(item: RecordItem): Record<string, string> {
  const value = bodyRecord(item.headers)
  return value ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
}

function connectorEnvironment(item: RecordItem): Record<string, string> {
  const value = bodyRecord(item.env)
  return value ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
}

function sameStdioCommand(input: RecordItem, prior: RecordItem): boolean {
  return prior.transport === 'stdio' && prior.command === input.command
    && JSON.stringify(prior.args ?? []) === JSON.stringify(input.args ?? [])
}

function connectorIsConfigured(connector: RecordItem): boolean {
  const value = connector.transport === 'stdio' ? connector.command : connector.endpoint
  return typeof value === 'string' && !!value.trim()
}

function employeeRuntimeConnector(db: Database, connector: RecordItem, employeeId: string, options: ServerOptions): RecordItem | undefined {
  const authentication = connectorAuthentication(connector)
  if (authentication.type === 'none') return connector
  const account = connectorAccount(db, connector, employeeId)
  if (!account || account.needsAuthorization) return undefined
  const runtime = connectorWithAccount(connector, account, options.dataDirectory)
  if (authentication.type === 'oauth') {
    const service = oauthServices.get(options)!
    runtimeOAuth.set(runtime, { provider: service.forAccount(connector, account), fetch: service.fetchFn })
  }
  return runtime
}

function configuredMcpConnection(connector: RecordItem, timeoutMs: number): McpConnection {
  const transport = connectorTransport(connector)
  if (transport === 'stdio') {
    if (typeof connector.command !== 'string' || !connector.command.trim()) throw new Error('MCP 启动命令未配置')
    if (!Array.isArray(connector.args) || !connector.args.every((arg): arg is string => typeof arg === 'string')) {
      throw new Error('MCP 启动参数必须是字符串数组')
    }
    return { transport, command: connector.command, args: connector.args, env: connectorEnvironment(connector), timeoutMs }
  }
  if (typeof connector.endpoint !== 'string' || !connector.endpoint.trim()) throw new Error('MCP 服务地址未配置')
  const oauth = runtimeOAuth.get(connector)
  return { endpoint: connector.endpoint, transport, headers: connectorHeaders(connector), timeoutMs,
    ...(oauth ? { authProvider: oauth.provider, fetch: oauth.fetch } : {}) }
}

function withConfiguredConnectorMcp<T>(connector: RecordItem, options: ServerOptions,
  use: Parameters<typeof withMcp<T>>[1], signal?: AbortSignal): Promise<T> {
  if (!options.mcpTimeoutMs) throw new Error('MCP 连接参数未配置')
  const connection = configuredMcpConnection(connector, options.mcpTimeoutMs)
  if (usesMallDataPermissions(connector) && connection.transport !== 'stdio') {
    const headers = new Headers(connection.headers)
    headers.delete('x-lfclaw-permission-assertion')
    connection.headers = Object.fromEntries(headers)
  }
  return withMcp({ ...connection, ...(signal ? { signal } : {}) }, async client => {
    if (!usesMallDataPermissions(connector) && client.getServerVersion()?.name === 'DBC MCP Server') {
      throw new Error('商场 MCP 必须开启商场数据权限')
    }
    return use(client)
  })
}

function validConnectorConfiguration(input: RecordItem, prior?: RecordItem): boolean {
  const authentication = input.authentication ?? prior?.authentication
  if (authentication !== undefined && (!validAuthentication(authentication, input.transport ?? prior?.transport)
    || usesMallDataPermissions({ ...prior, ...input }) && authentication.type !== 'none')) return false
  if (authentication && bodyRecord(authentication)?.type === 'oauth') {
    try { validOAuthUrl(String(input.endpoint ?? prior?.endpoint)) } catch { return false }
  }
  if (input.transport !== undefined && (typeof input.transport !== 'string' || !['sse', 'streamable-http', 'stdio'].includes(input.transport))) return false
  if (input.authMode !== undefined && input.authMode !== 'mall' && input.authMode !== 'headers') return false
  if (input.mallDataPermissions !== undefined && typeof input.mallDataPermissions !== 'boolean') return false
  if (!validImageIcon(input.icon)) return false
  if (input.employeeCredentials !== undefined && input.employeeCredentials !== 'wechat-mp' && input.employeeCredentials !== 'shared') return false
  if ((input.employeeCredentials ?? prior?.employeeCredentials) === 'wechat-mp'
    && ((input.transport ?? prior?.transport) !== 'stdio' || usesMallDataPermissions({ ...prior, ...input }))) return false
  if ((input.transport ?? prior?.transport) === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 4096 || /[\0\r\n]/.test(input.command)) return false
    if (input.args !== undefined && (!Array.isArray(input.args) || input.args.length > 100
      || !input.args.every(arg => typeof arg === 'string' && arg.length <= 8192 && !arg.includes('\0')))) return false
    const env = input.env === undefined ? {} : bodyRecord(input.env)
    if (!env || Object.keys(env).length > 100) return false
    const names = new Set<string>()
    for (const [name, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name) || names.has(name.toUpperCase())
        || typeof value !== 'string' || value.length > 16384 || value.includes('\0')) return false
      if (!value && (!prior || !sameStdioCommand(input, prior) || !Object.hasOwn(connectorEnvironment(prior), name))) return false
      names.add(name.toUpperCase())
    }
    return true
  }
  if (input.endpoint !== undefined && typeof input.endpoint !== 'string') return false
  if (typeof input.endpoint === 'string' && input.endpoint.trim()) {
    try { remoteMcpEndpoint(input.endpoint) } catch { return false }
  }
  if (input.headers === undefined) return true
  const headers = bodyRecord(input.headers)
  if (!headers || Object.keys(headers).length > 20) return false
  const names = new Set<string>()
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name) || names.has(lower)
      || ['host', 'content-length', 'cookie', 'x-lfclaw-permission-assertion'].includes(lower)
      || lower.startsWith('mcp-') || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) return false
    if (!value && (!prior || prior.endpoint !== input.endpoint
      || !Object.hasOwn(connectorHeaders(prior), name))) return false
    names.add(lower)
  }
  return true
}

function validMallConnectorAssignment(input: RecordItem, db: Database): boolean {
  return !usesMallDataPermissions(input) || !db.connectors.some(item =>
    item.id !== input.id && usesMallDataPermissions(item))
}

async function verifyChangedMallConfiguration(input: RecordItem, prior: RecordItem | undefined,
  options: ServerOptions, res: Response): Promise<boolean> {
  if (!usesMallDataPermissions(input) || prior && usesMallDataPermissions(prior)
    && prior.endpoint === input.endpoint && connectorTransport(prior) === connectorTransport(input)
    && prior.command === input.command && JSON.stringify(prior.args) === JSON.stringify(input.args)
    && JSON.stringify(connectorEnvironment(prior)) === JSON.stringify(connectorEnvironment(input))
    && JSON.stringify(connectorHeaders(prior)) === JSON.stringify(connectorHeaders(input))) return true
  if (!options.mcpTimeoutMs) {
    res.status(503).json({ code: 'MCP_NOT_CONFIGURED', message: 'MCP 连接超时尚未配置' }); return false
  }
  try {
    await withConfiguredConnectorMcp(input, options, client =>
      client.listTools(undefined, { timeout: options.mcpTimeoutMs }))
    return true
  } catch (error) {
    console.error('LFClaw 商场连接验证失败:', error instanceof Error ? error.name : 'unknown')
    res.status(502).json({ code: 'MCP_PERMISSION_UNVERIFIED', message: 'MCP 连接验证未通过，请检查地址或启动命令、传输方式与认证配置；配置未保存' })
    return false
  }
}

function employeeCanUseExpert(expert: RecordItem, employee: RecordItem, db: Database): boolean {
  if (!authorizationFor(expert, employee, db).allowed) return false
  if (expert.source !== 'team') return true
  return Array.isArray(expert.memberIds) && expert.memberIds.length >= 2
    && expert.memberIds.every(id => typeof id === 'string' && db.experts.some(member =>
      member.id === id && member.source !== 'team' && authorizationFor(member, employee, db).allowed))
}

function updatedItem(collection: CollectionName, prior: RecordItem | undefined, input: RecordItem): RecordItem {
  if (collection === 'connectors') {
    const { showInClient: _previousInput, authMode: _legacyAuthMode, account: _accountSummary, ...nextInput } = input
    const previous: Record<string, unknown> = { ...prior }
    delete previous.showInClient
    delete previous.authMode
    const authentication = connectorAuthentication({ ...prior, ...input, id: input.id })
    const mappedHeaders = new Set(authentication.fields.filter(field => field.target === 'header').map(field => field.name.toLowerCase()))
    if (authentication.type === 'oauth') mappedHeaders.add('authorization')
    const headers = Object.fromEntries(Object.entries(connectorHeaders(input)).filter(([key]) => !mappedHeaders.has(key.toLowerCase())))
    const priorHeaders = prior && prior.endpoint === input.endpoint
      ? connectorHeaders(prior) : {}
    const stdio = (input.transport ?? prior?.transport) === 'stdio'
    const employeeCredentials = input.employeeCredentials ?? prior?.employeeCredentials ?? 'shared'
    const mappedEnv = new Set(authentication.fields.filter(field => field.target === 'env').map(field => field.name.toUpperCase()))
    const env = Object.fromEntries(Object.entries(connectorEnvironment(input)).filter(([name]) => !mappedEnv.has(name.toUpperCase())
      && (employeeCredentials !== 'wechat-mp' || !['WECHAT_APP_ID', 'WECHAT_APP_SECRET'].includes(name.toUpperCase()))))
    const priorEnv = prior && sameStdioCommand(input, prior) ? connectorEnvironment(prior) : {}
    return { ...previous, ...nextInput,
      transport: input.transport ?? prior?.transport ?? 'sse',
      employeeCredentials: stdio ? employeeCredentials : 'shared',
      endpoint: stdio ? '' : input.endpoint ?? prior?.endpoint,
      command: stdio ? input.command : undefined,
      args: stdio ? input.args ?? [] : undefined,
      env: stdio ? Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value || priorEnv[name] || ''])) : {},
      mallDataPermissions: input.mallDataPermissions !== undefined || input.authMode !== undefined
        ? usesMallDataPermissions(input) : prior ? usesMallDataPermissions(prior) : false,
      headers: stdio ? {} : Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, value || priorHeaders[name] || ''])),
      showToolsInClient: input.showToolsInClient ?? input.showInClient
        ?? prior?.showToolsInClient ?? (prior?.showInClient !== false) }
  }
  if (collection === 'employees') {
    const { mcpPermissions: _ignored, ...safeInput } = input
    return {
      ...prior, ...safeInput, activationCode: prior?.activationCode ?? issueActivationCode(String(input.name)),
      status: input.status === 'inactive' ? 'inactive' : 'active',
    }
  }
  if (collection === 'models') {
    const next: RecordItem = { ...prior, ...input, ...modelCapacity({ ...prior, ...input }) }
    if (!input.apiKey) next.apiKey = prior?.apiKey ?? ''
    return next
  }
  if (collection === 'experts') {
    const oldConfig = prior && prior.source === input.source ? bodyRecord(prior.externalConfig) : null
    const newConfig = bodyRecord(input.externalConfig)
    if (newConfig && !newConfig.apiKey) {
      return { ...prior, ...input, externalConfig: { ...oldConfig, ...newConfig, apiKey: oldConfig?.apiKey ?? '' } }
    }
  }
  return { ...prior, ...input }
}

function savedSkillArchive(skillsDirectory: string, item: RecordItem, limits: Limits): { description: string; sha256: string; archive: Buffer } {
  const filename = item.zipPath
  if (typeof filename !== 'string' || !/^[0-9a-f-]{36}\.zip$/.test(filename)) throw new Error('请上传技能 ZIP 包')
  const path = join(skillsDirectory, filename)
  if (!existsSync(path)) throw new Error('技能 ZIP 包不存在，请重新上传')
  const archive = readFileSync(path)
  return { description: skillDescription(new Uint8Array(archive), limits), sha256: createHash('sha256').update(archive).digest('hex'), archive }
}

interface SkillVersionRecord {
  revision: number
  version: string
  zipPath: string
  sha256: string
  description: string
  createdAt: string
  restoredFromRevision?: number
}

function skillHistory(item: RecordItem, skillsDirectory: string, limits: Limits): SkillVersionRecord[] {
  if (Array.isArray(item.history)) {
    const history: SkillVersionRecord[] = []
    for (const value of item.history) {
      const entry = bodyRecord(value)
      if (!entry || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1
        || typeof entry.version !== 'string' || typeof entry.zipPath !== 'string'
        || !/^[0-9a-f-]{36}\.zip$/.test(entry.zipPath)
        || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)
        || typeof entry.description !== 'string' || typeof entry.createdAt !== 'string') {
        throw new StoreError('DATA_INVALID', '技能版本记录无效')
      }
      history.push({ revision: Number(entry.revision), version: entry.version, zipPath: entry.zipPath,
        sha256: entry.sha256, description: entry.description, createdAt: entry.createdAt,
        ...(Number.isSafeInteger(entry.restoredFromRevision) ? { restoredFromRevision: Number(entry.restoredFromRevision) } : {}) })
    }
    if (history.length === 0 || history.some((entry, index) => index > 0 && entry.revision <= history[index - 1]!.revision)) {
      throw new StoreError('DATA_INVALID', '技能版本顺序无效')
    }
    const current = history.at(-1)!
    if (current.zipPath !== item.zipPath || current.sha256 !== item.sha256
      || current.description !== item.description || current.version !== item.version) {
      throw new StoreError('DATA_INVALID', '技能当前版本与历史记录不一致')
    }
    return history
  }
  const archive = savedSkillArchive(skillsDirectory, item, limits)
  const revision = Number.isSafeInteger(item.revision) && Number(item.revision) >= 1 ? Number(item.revision) : 1
  return [{ revision, version: typeof item.version === 'string' ? item.version : String(revision),
    zipPath: String(item.zipPath), sha256: archive.sha256, description: archive.description,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString() }]
}

function updatedSkill(prior: RecordItem | undefined, input: RecordItem,
  archive: { description: string; sha256: string }, skillsDirectory: string, limits: Limits): RecordItem {
  const previous = prior ? skillHistory(prior, skillsDirectory, limits) : []
  const changed = prior?.zipPath !== input.zipPath
  const revision = prior && !changed ? previous.at(-1)!.revision : (previous.at(-1)?.revision ?? 0) + 1
  const version = prior && !changed ? previous.at(-1)!.version : String(revision)
  const history: SkillVersionRecord[] = changed
    ? [...previous, { revision, version, zipPath: String(input.zipPath), sha256: archive.sha256,
      description: archive.description, createdAt: new Date().toISOString() }] : previous
  return { ...prior, ...input, description: archive.description, sha256: archive.sha256,
    source: 'enterprise', parsingStatus: 'success', history, revision, version }
}

function sanitizeItem(collection: CollectionName, item: RecordItem): RecordItem {
  if (collection === 'models') return publicModel(item)
  if (collection === 'connectors') return publicConnector(item)
  if (collection === 'experts') {
    const config = bodyRecord(item.externalConfig)
    return config ? { ...item, externalConfig: { ...config, apiKey: '' } } : item
  }
  return item
}

function employeeForToken(options: ServerOptions, req: Request): RecordItem | null {
  const session = options.auth.resolve(bearerToken(req))
  if (session?.principal !== 'employee') return null
  const employee = options.store.read().employees.find(item => item.id === session.employeeId)
  if (!employee || employee.status !== 'active' || activationHash(String(employee.activationCode)) !== session.activationCodeHash) return null
  return employee
}

function employeeModels(db: Database, employee: RecordItem) {
  return db.models.filter(model => authorizationFor(model, employee, db).allowed).map(model => ({
    id: model.id, name: model.name, type: model.type, protocol: model.protocol, isDefault: model.isDefault, ...modelCapacity(model),
    permissionSource: authorizationFor(model, employee, db).source,
  }))
}

function employeeSkillMetadata(options: ServerOptions, skill: RecordItem, employee: RecordItem, db: Database) {
  return {
    id: skill.id, name: skill.name, version: skill.version, description: skill.description,
    revision: skill.revision ?? 1, sha256: skill.sha256 ?? savedSkillArchive(options.skillsDirectory, skill, options.skillArchiveLimits).sha256,
    source: skill.source, permissionSource: authorizationFor(skill, employee, db).source,
  }
}

async function callModel(model: RecordItem, messages: unknown, maxTokens: number, timeoutMs: number,
  extras: Record<string, unknown> = {}, stream?: { signal: AbortSignal; write: (event: string) => Promise<void> }): Promise<{ status: number; body: unknown }> {
  const upstreamModelId = typeof model.upstreamModelId === 'string' && model.upstreamModelId.trim()
    ? model.upstreamModelId.trim() : model.name
  if (typeof model.baseUrl !== 'string' || typeof model.apiKey !== 'string' || !model.apiKey
    || typeof upstreamModelId !== 'string' || !upstreamModelId || model.protocol !== 'openai-compatible') {
    return { status: 422, body: { code: 'MODEL_CONFIG_INVALID', message: '模型连接参数未配置完整' } }
  }
  let endpoint: URL
  try {
    endpoint = new URL(model.baseUrl.replace(/\/+$/, '') + '/chat/completions')
    if (endpoint.protocol !== 'https:') throw new Error('HTTPS required')
  } catch {
    return { status: 422, body: { code: 'MODEL_CONFIG_INVALID', message: '模型 Base URL 必须是 HTTPS 地址' } }
  }
  const deadline = modelResponseDeadline(timeoutMs, stream?.signal)
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify({ ...extras, ...modelThinkingOption(model), model: upstreamModelId, messages, max_tokens: maxTokens, stream: !!stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }),
      signal: deadline.signal,
    })
    if (!upstream.ok) {
      return { status: 502, body: { code: 'MODEL_UPSTREAM_ERROR', message: `模型服务返回 HTTP ${upstream.status}` } }
    }
    if (stream && upstream.headers.get('content-type')?.includes('text/event-stream')) {
      return { status: 200, body: await forwardCompletionStream(upstream, stream.write, deadline.activity) }
    }
    if (Number(upstream.headers.get('content-length') ?? '0') > 2 * 1024 * 1024) {
      return { status: 502, body: { code: 'MODEL_RESPONSE_TOO_LARGE', message: '模型响应超出限制' } }
    }
    const reader = upstream.body?.getReader()
    if (!reader) return { status: 502, body: { code: 'MODEL_UPSTREAM_ERROR', message: '模型服务未返回内容' } }
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 2 * 1024 * 1024) {
        await reader.cancel()
        return { status: 502, body: { code: 'MODEL_RESPONSE_TOO_LARGE', message: '模型响应超出限制' } }
      }
      chunks.push(value)
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks))
    return { status: 200, body: JSON.parse(text) }
  } catch (error) {
    console.error('LFClaw 模型网关调用失败:', error instanceof Error ? error.name : 'unknown')
    if (error instanceof Error && error.name === 'TimeoutError') return { status: 504, body: { code: 'MODEL_TIMEOUT', message: '模型响应超时，请稍后重试' } }
    return { status: 502, body: { code: 'MODEL_UNAVAILABLE', message: '模型连接失败或输出中断，请重试' } }
  } finally { deadline.dispose() }
}

/** Express routes are separated from listen() so tests can use an isolated data directory. */
export function createApp(options: ServerOptions): express.Express {
  const app = express()
  const authLimit = new AuthLimit(options.authWindowMs, options.loginMaxFailures, options.activationMaxFailures)
  app.disable('x-powered-by')
  app.use(cors({ origin: options.allowedOrigin, allowedHeaders: ['Authorization', 'Content-Type'] }))
  mountSessionSharing(app, options)
  app.use(express.json({ limit: '4mb' }))
  const oauth = new ConnectorOAuth(options.store, options.oauthCallbackUrl ?? '',
    options.mcpTimeoutMs ?? options.modelTimeoutMs, options.oauthFlowTtlMs ?? options.authWindowMs, options.signal)
  oauthServices.set(options, oauth)
  mountConnectorAuthentication(app, options, { oauth, employee: req => employeeForToken(options, req),
    discover: async (connector, signal, provider) => {
      if (provider) runtimeOAuth.set(connector, { provider, fetch: oauth.fetchFn })
      return withConfiguredConnectorMcp(connector, options, async client => {
        const tools: { name: string; description?: string }[] = []
        let cursor: string | undefined
        const seen = new Set<string>()
        do {
          const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: options.mcpTimeoutMs, ...(signal ? { signal } : {}) })
          tools.push(...result.tools.map(tool => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}) })))
          cursor = result.nextCursor
          if (cursor && seen.has(cursor)) throw new Error('MCP 分页游标重复')
          if (cursor) seen.add(cursor)
        } while (cursor)
        return tools
      }, signal)
    } })
  app.get('/api/branding', (_req, res) => res.json(options.store.read().branding))

  app.post('/api/admin/login', (req, res) => {
    const address = req.socket.remoteAddress ?? 'unknown'
    const retryAfter = authLimit.retryAfter('login', address)
    if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); res.status(429).json({ code: 'TOO_MANY_ATTEMPTS', message: '登录尝试过多，请稍后重试' }); return }
    const body = bodyRecord(req.body)
    if (typeof body?.username !== 'string' || typeof body.password !== 'string') {
      authLimit.failure('login', address)
      res.status(400).json({ code: 'INVALID_INPUT', message: '请输入账号和密码' })
      return
    }
    const token = options.auth.login(body.username, body.password)
    if (!token) {
      authLimit.failure('login', address)
      res.status(401).json({ code: 'INVALID_CREDENTIALS', message: '账号或密码错误' })
      return
    }
    authLimit.success('login', address)
    res.json({ token, displayName: '超级管理员' })
  })

  app.post('/api/employee/activate', (req, res) => {
    const address = req.socket.remoteAddress ?? 'unknown'
    const retryAfter = authLimit.retryAfter('activation', address)
    if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); res.status(429).json({ code: 'TOO_MANY_ATTEMPTS', message: '激活尝试过多，请稍后重试' }); return }
    const body = bodyRecord(req.body)
    if (typeof body?.code !== 'string' || body.code.length > 128) {
      authLimit.failure('activation', address)
      res.status(400).json({ code: 'INVALID_INPUT', message: '激活码格式错误' })
      return
    }
    const employee = options.store.read().employees.find(item => item.activationCode === body.code)
    if (!employee || employee.status !== 'active') {
      authLimit.failure('activation', address)
      res.status(401).json({ code: 'INVALID_ACTIVATION', message: '激活码无效或账号已停用' })
      return
    }
    authLimit.success('activation', address)
    const token = options.auth.issue({ principal: 'employee', employeeId: employee.id, activationCodeHash: activationHash(body.code) })
    res.json({ token, employee: { id: employee.id, name: employee.name, departmentId: employee.departmentId } })
  })

  app.post('/api/employee/experts/prepare', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const body = bodyRecord(req.body)
    const result = prepareExpert(options.store.read(), employee, body?.owner, body?.id)
    if ('error' in result) { res.status(409).json({ code: 'EXPERT_NOT_READY', message: result.error }); return }
    res.json(result.definition)
  })

  app.post('/api/employee/personal-experts/draft', async (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const description = bodyRecord(req.body)?.description
    if (typeof description !== 'string' || !description.trim() || description.length > 4000) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '请用不超过 4000 字描述专家职责' }); return
    }
    const db = options.store.read()
    const model = db.models.find(item => item.isDefault === true && authorizationFor(item, employee, db).allowed)
    if (!model) { res.status(503).json({ code: 'MODEL_NOT_READY', message: '你尚无可用的企业默认模型' }); return }
    const result = await callModel(model, [
      { role: 'system', content: '你是个人专家配置助手。根据用户描述生成只属于该用户的专家草稿。只返回 JSON 对象，不要代码块或解释。字段：name（40字以内）、description（160字以内）、instructions（4000字以内，说明职责、工作方法与输出要求）、tags（1到5个短标签）。不得生成密钥、虚构企业权限或暗示已接入工具。' },
      { role: 'user', content: description.trim() },
    ], 1200, options.modelTimeoutMs)
    if (result.status !== 200) { res.status(result.status).json(result.body); return }
    const choices = bodyRecord(result.body)?.choices
    const content = Array.isArray(choices) ? bodyRecord(bodyRecord(choices[0])?.message)?.content : null
    let draft: Record<string, unknown> | null = null
    try { draft = typeof content === 'string' ? bodyRecord(JSON.parse(content.trim())) : null }
    catch { /* 非 JSON 的模型输出由下方报告给员工重新描述。 */ }
    if (!draft || typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 40
      || typeof draft.description !== 'string' || draft.description.length > 160
      || typeof draft.instructions !== 'string' || !draft.instructions.trim() || draft.instructions.length > 4000
      || !Array.isArray(draft.tags) || draft.tags.length < 1 || draft.tags.length > 5
      || !draft.tags.every(tag => typeof tag === 'string' && tag.length <= 20)) {
      res.status(502).json({ code: 'DRAFT_INVALID', message: '模型未返回有效专家草稿，请调整描述后重试' }); return
    }
    res.json({ name: draft.name.trim(), description: draft.description.trim(),
      instructions: draft.instructions.trim(), tags: draft.tags })
  })

  app.get('/api/employee/personal-experts', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    res.json(options.store.read().personalExperts.filter(item => item.ownerEmployeeId === employee.id))
  })
  app.get('/api/employee/personal-experts/:id', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const item = options.store.read().personalExperts.find(value => value.id === req.params.id && value.ownerEmployeeId === employee.id)
    if (!item) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.json({ ...item, revision: expertRevision(item) })
  })
  app.post('/api/employee/personal-expert-teams', (req, res, next) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    try {
      const result = options.store.update(db => {
        const resolved = resolvePersonalTeam(req.body, db, employee)
        db.personalExperts.push(...resolved.members, resolved.team)
        return resolved
      })
      res.status(201).json(result)
    } catch (error) {
      if (error instanceof PersonalTeamError) res.status(400).json({ code: 'INVALID_TEAM', message: error.message })
      else next(error)
    }
  })
  app.post('/api/employee/personal-experts', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    if (!validPersonalExpert(req.body)) { res.status(400).json({ code: 'INVALID_EXPERT', message: '个人专家配置无效' }); return }
    if (!personalReferencesAllowed(options.store.read(), employee, req.body)) {
      res.status(400).json({ code: 'INVALID_DEPENDENCY', message: '成员或依赖不可用，请重新读取可用资源后选择' }); return
    }
    const item = options.store.update(db => {
      const created = { id: randomUUID(), ownerEmployeeId: employee.id, source: 'personal',
        name: String(req.body.name).trim(), description: String(req.body.description).trim(),
        instructions: String(req.body.instructions).trim(), tags: req.body.tags,
        ...expertCapabilities(req.body),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      db.personalExperts.push(created)
      return created
    })
    res.status(201).json(item)
  })
  app.put('/api/employee/personal-experts/:id', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    if (!validPersonalExpert(req.body)) { res.status(400).json({ code: 'INVALID_EXPERT', message: '个人专家配置无效' }); return }
    if (!personalReferencesAllowed(options.store.read(), employee, req.body, req.params.id)) {
      res.status(400).json({ code: 'INVALID_DEPENDENCY', message: '成员或依赖不可用，请重新读取可用资源后选择' }); return
    }
    if (req.body.expectedRevision !== undefined && (typeof req.body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.expectedRevision))) {
      res.status(400).json({ code: 'INVALID_REVISION', message: '请重新读取专家后修改' }); return
    }
    let conflict = false
    const item = options.store.update(db => {
      const current = db.personalExperts.find(value => value.id === req.params.id && value.ownerEmployeeId === employee.id)
      if (!current) return null
      if (req.body.expectedRevision !== undefined && req.body.expectedRevision !== expertRevision(current)) { conflict = true; return null }
      current.name = String(req.body.name).trim()
      current.description = String(req.body.description).trim()
      current.instructions = String(req.body.instructions).trim()
      current.tags = req.body.tags
      Object.assign(current, expertCapabilities(req.body))
      current.updatedAt = new Date().toISOString()
      return current
    })
    if (conflict) { res.status(409).json({ code: 'EXPERT_CHANGED', message: '专家已被修改，请重新读取后再保存' }); return }
    if (!item) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.json(item)
  })
  app.delete('/api/employee/personal-experts/:id', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const deleted = options.store.update(db => {
      const index = db.personalExperts.findIndex(value => value.id === req.params.id && value.ownerEmployeeId === employee.id)
      if (index < 0) return false
      db.personalExperts.splice(index, 1)
      return true
    })
    if (!deleted) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.status(204).end()
  })

  app.post('/api/employee/personal-skills/report', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const body = bodyRecord(req.body)
    if (!body || body.employeeId !== employee.id || typeof body.deviceId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.deviceId)
      || !Array.isArray(body.skills) || body.skills.length > 500) { res.status(400).json({ code: 'INVALID_METADATA' }); return }
    const skills: { name: string; description: string; version: string; source: string; enabled: boolean }[] = []
    const names = new Set<string>()
    for (const value of body.skills) {
      const item = bodyRecord(value)
      if (!item || Object.keys(item).some(key => !['name', 'description', 'version', 'source', 'enabled'].includes(key))
        || typeof item.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.name) || item.name.length > 60
        || names.has(item.name) || typeof item.description !== 'string' || item.description.length > 2000
        || typeof item.version !== 'string' || item.version.length > 64 || item.source !== 'personal'
        || typeof item.enabled !== 'boolean') { res.status(400).json({ code: 'INVALID_METADATA' }); return }
      names.add(item.name)
      skills.push({ name: item.name, description: item.description, version: item.version, source: 'personal', enabled: item.enabled })
    }
    options.store.update(db => {
      const id = `${employee.id}:${body.deviceId}`
      db.personalSkillReports = db.personalSkillReports.filter(item => item.id !== id)
      db.personalSkillReports.push({ id, ownerEmployeeId: employee.id, deviceId: body.deviceId, updatedAt: new Date().toISOString(), skills })
    })
    res.status(204).end()
  })

  for (const catalog of ['model-catalog', 'skill-catalog'] as const) {
    app.get(`/api/employee/${catalog}`, (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store')
      const employee = employeeForToken(options, req)
      if (!employee) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: '登录已失效或账号已停用' })
        return
      }
      const db = options.store.read()
      res.json(catalog === 'model-catalog' ? { models: employeeModels(db, employee) } : {
        employee: { id: employee.id },
        skills: db.skills.filter(skill => authorizationFor(skill, employee, db).allowed)
          .map(skill => employeeSkillMetadata(options, skill, employee, db)),
      })
    })
  }

  for (const picker of ['identity', 'expert-picker', 'connector-picker'] as const) {
    app.get(`/api/employee/${picker}`, (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store')
      const employee = employeeForToken(options, req)
      if (!employee) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: '登录已失效或账号已停用' })
        return
      }
      if (picker === 'identity') { res.json({ employee: { id: employee.id } }); return }
      const db = options.store.read()
      if (picker === 'connector-picker') {
        res.json({ connectors: employeeConnectors(db, employee).map(connector => ({
          id: connector.id, name: connector.name, hasAvailableTools: connector.tools.length > 0,
        })) })
        return
      }
      res.json({
        experts: db.experts.filter(expert => employeeCanUseExpert(expert, employee, db)).map(expert => ({
          id: expert.id, name: expert.name, description: expert.description, source: expert.source,
        })),
        personalExperts: db.personalExperts.filter(expert => expert.ownerEmployeeId === employee.id).map(expert => ({
          id: expert.id, name: expert.name, description: expert.description, kind: expert.kind,
        })),
      })
    })
  }

  app.get('/api/employee/me', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '登录已失效或账号已停用' })
      return
    }
    const db = options.store.read()
    res.json({ employee: { id: employee.id, name: employee.name, departmentId: employee.departmentId,
      departmentName: db.departments.find(department => department.id === employee.departmentId)?.name ?? null,
      status: employee.status, activationCode: employee.activationCode },
      models: employeeModels(db, employee),
      skills: db.skills.filter(skill => authorizationFor(skill, employee, db).allowed).map(skill => ({
        ...employeeSkillMetadata(options, skill, employee, db), icon: skill.icon,
      })),
      connectors: employeeConnectors(db, employee),
      experts: db.experts.filter(expert => employeeCanUseExpert(expert, employee, db)).map(expert => ({
        id: expert.id, name: expert.name, description: expert.description, instructions: expert.instructions,
        tags: expert.tags, source: expert.source, memberIds: expert.source === 'team' ? expert.memberIds : undefined,
        skillIds: expert.skillIds ?? [], connectorIds: expert.connectorIds ?? [], quickPrompts: expert.quickPrompts ?? [],
        permissionSource: authorizationFor(expert, employee, db).source,
      })),
      personalExperts: db.personalExperts.filter(item => item.ownerEmployeeId === employee.id),
      notifications: db.notifications.filter(item => item.revokedAt === undefined &&
        (!Array.isArray(item.deletedBy) || !item.deletedBy.includes(employee.id))).map(item => ({
        id: item.id, title: item.title, content: item.content, sentAt: item.sentAt,
      })),
    })
  })

  app.get('/api/employee/announcements', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    res.setHeader('Cache-Control', 'private, no-store')
    res.json(options.store.read().notifications.filter(item => item.revokedAt === undefined &&
      (!Array.isArray(item.deletedBy) || !item.deletedBy.includes(employee.id))).map(item => ({
      id: item.id, title: item.title, content: item.content, sentAt: item.sentAt,
      read: Array.isArray(item.readBy) && item.readBy.includes(employee.id),
    })))
  })

  app.post('/api/employee/announcements', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const body = bodyRecord(req.body)
    if (!body || typeof body.id !== 'string' || !['read', 'unread', 'delete', 'clear'].includes(String(body.action))
      || (body.action === 'clear' ? body.id !== 'all' : !/^[a-f0-9-]{36}$/.test(body.id))) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '公告操作无效' }); return
    }
    const found = options.store.update(db => {
      const items = db.notifications.filter(item => item.revokedAt === undefined
        && (body.action === 'clear' || item.id === body.id))
      if (body.action !== 'clear' && !items.length) return false
      for (const item of items) {
        if (body.action === 'read' || body.action === 'unread') {
          const readBy = Array.isArray(item.readBy) ? item.readBy.filter(id => id !== employee.id) : []
          item.readBy = body.action === 'read' ? [...readBy, employee.id] : readBy
        } else {
          const deletedBy = Array.isArray(item.deletedBy) ? item.deletedBy : []
          if (!deletedBy.includes(employee.id)) item.deletedBy = [...deletedBy, employee.id]
        }
      }
      return true
    })
    if (!found) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.status(204).end()
  })

  app.get('/api/employee/skills/:id/download', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const db = options.store.read()
    const skill = db.skills.find(item => item.id === req.params.id)
    if (!skill || !authorizationFor(skill, employee, db).allowed) {
      res.status(403).json({ code: 'SKILL_FORBIDDEN', message: '技能未授权或已停用' }); return
    }
    let archive: ReturnType<typeof savedSkillArchive>
    try { archive = savedSkillArchive(options.skillsDirectory, skill, options.skillArchiveLimits) }
    catch { res.status(503).json({ code: 'SKILL_UNAVAILABLE', message: '技能包暂不可用' }); return }
    if (typeof skill.sha256 === 'string' && skill.sha256 !== archive.sha256) {
      res.status(503).json({ code: 'SKILL_INTEGRITY_ERROR', message: '技能包校验失败' }); return
    }
    res.setHeader('ETag', `"${archive.sha256}"`)
    res.setHeader('Cache-Control', 'private, no-cache')
    if (req.headers['if-none-match'] === `"${archive.sha256}"`) { res.status(304).end(); return }
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="skill-${archive.sha256.slice(0, 12)}.zip"`)
    res.send(archive.archive)
  })

  app.post('/api/employee/personal-connectors/check', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const body = bodyRecord(req.body)
    let endpoint: URL
    try { endpoint = remoteMcpEndpoint(typeof body?.url === 'string' ? body.url : '') }
    catch { res.status(400).json({ code: 'INVALID_INPUT' }); return }
    const protectedService = options.store.read().connectors.some(connector => {
      if (!usesMallDataPermissions(connector) || typeof connector.endpoint !== 'string') return false
      return remoteMcpEndpoint(connector.endpoint).origin === endpoint.origin
    })
    if (protectedService) { res.status(403).json({ code: 'MALL_CONNECTOR_REQUIRED' }); return }
    res.json({ allowed: true })
  })

  app.get('/api/employee/connector-catalog', (req, res) => {
    sendConnectorCatalog(options.store, () => employeeForToken(options, req), req, res, options.mcpTimeoutMs ?? options.modelTimeoutMs)
  })

  app.put('/api/employee/connectors/:id/account', async (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const db = options.store.read()
    const connector = db.connectors.find(item => item.id === req.params.id)
    if (!connector || !authorizationFor(connector, employee, db).allowed) { res.status(403).json({ code: 'CONNECTOR_FORBIDDEN' }); return }
    if (connector.employeeCredentials !== 'wechat-mp' || connector.transport !== 'stdio') {
      res.status(400).json({ code: 'ACCOUNT_NOT_SUPPORTED' }); return
    }
    const body = bodyRecord(req.body)
    if (!body || Object.keys(body).some(key => !['appId', 'appSecret'].includes(key))
      || !['appId', 'appSecret'].every(key => typeof body[key] === 'string'
        && (body[key] as string).length <= 4096 && !/[\0\r\n]/.test(body[key] as string))) {
      res.status(400).json({ code: 'ACCOUNT_INVALID' }); return
    }
    const previous = connectorAccount(db, connector, employee.id)
    const appId = (body.appId as string).trim() || previous?.appId
    const appSecret = (body.appSecret as string).trim() || previous?.appSecret
    if (!appId || !appSecret || (appId !== previous?.appId && !(body.appSecret as string).trim())) {
      res.status(400).json({ code: 'ACCOUNT_INVALID' }); return
    }
    if (!options.mcpTimeoutMs) { res.status(503).json({ code: 'MCP_NOT_CONFIGURED' }); return }
    const account: ConnectorAccount = { employeeId: employee.id, connectorId: connector.id,
      configuration: accountConfiguration(connector), revision: randomUUID(), appId, appSecret }
    const access = guardConnectorAccess(options.store, () => employeeForToken(options, req), connector.id, res)
    try {
      const runtime = connectorWithAccount(connector, account, options.dataDirectory)
      const tools = await discoverMcpTools({ ...configuredMcpConnection(runtime, options.mcpTimeoutMs), signal: access.signal })
      access.assertCurrent()
      options.store.update(current => {
        current.connectorAccounts = current.connectorAccounts.filter(item =>
          item.employeeId !== employee.id || item.connectorId !== connector.id)
        current.connectorAccounts.push(account)
        const target = current.connectors.find(item => item.id === connector.id)!
        const existing = Array.isArray(target.tools) ? target.tools : []
        const names = new Set(existing.map(tool => bodyRecord(tool)?.name))
        target.tools = [...existing, ...tools.filter(tool => !names.has(tool.name))
          .map(tool => ({ id: tool.name, name: tool.name, description: tool.description ?? '', allowed: true }))]
      })
      res.setHeader('Cache-Control', 'no-store')
      res.json({ configured: true })
    } catch (error) {
      if (access.signal.reason instanceof ConnectorAccessChanged) { res.status(409).json({ code: 'CONNECTOR_ACCESS_CHANGED' }); return }
      console.error('员工连接器账号验证失败:', error instanceof Error ? error.name : 'unknown')
      res.status(502).json({ code: 'ACCOUNT_CONNECTION_FAILED' })
    } finally { access.dispose() }
  })

  app.delete('/api/employee/connectors/:id/account', (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const db = options.store.read()
    const connector = db.connectors.find(item => item.id === req.params.id)
    if (!connector || !authorizationFor(connector, employee, db).allowed) { res.status(403).json({ code: 'CONNECTOR_FORBIDDEN' }); return }
    options.store.update(current => {
      current.connectorAccounts = current.connectorAccounts.filter(item => item.employeeId !== employee.id || item.connectorId !== connector.id)
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ configured: false })
  })

  app.get('/api/employee/connectors/:id/tools', async (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const db = options.store.read()
    const connector = db.connectors.find(item => item.id === req.params.id)
    if (!connector || !authorizationFor(connector, employee, db).allowed) { res.status(403).json({ code: 'CONNECTOR_FORBIDDEN' }); return }
    if (!connectorIsConfigured(connector) || !options.mcpTimeoutMs) {
      res.status(503).json({ code: 'MCP_NOT_CONFIGURED', message: 'MCP 连接参数尚未配置完整' }); return
    }
    const runtime = employeeRuntimeConnector(db, connector, employee.id, options)
    if (!runtime) { res.status(428).json({ code: 'ACCOUNT_REQUIRED' }); return }
    const access = guardConnectorAccess(options.store, () => employeeForToken(options, req), connector.id, res)
    try {
      const allowed = new Set(connectorTools(connector, permissionsForEmployee(db, employee)).map(tool => tool.name))
      if (allowed.size === 0) { res.json({ tools: [] }); return }
      const result = await withConfiguredConnectorMcp(runtime, options, client => {
          access.assertCurrent()
          return client.listTools(undefined, { timeout: options.mcpTimeoutMs, signal: access.signal })
        }, access.signal)
      access.assertCurrent()
      res.setHeader('Cache-Control', 'no-store')
      res.json({ tools: result.tools.filter(tool => allowed.has(tool.name)).map(tool =>
        usesMallDataPermissions(connector) ? mallPublicSchema(tool, permissionsForEmployee(db, employee)) : tool) })
    } catch (error) {
      if (access.signal.reason instanceof ConnectorAccessChanged) { res.status(403).json({ code: 'CONNECTOR_ACCESS_CHANGED', message: '连接器权限已变化，请重新查询' }); return }
      if (error instanceof ConnectorAuthorizationRequired) { res.status(428).json({ code: 'ACCOUNT_REQUIRED', message: '请重新连接账号' }); return }
      console.error('LFClaw MCP 查询失败:', error instanceof Error ? error.name : 'unknown')
      res.status(502).json({ code: 'MCP_UNAVAILABLE', message: 'MCP 服务暂不可用' })
    } finally { access.dispose() }
  })

  app.post('/api/employee/connectors/:id/call', async (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
    const db = options.store.read()
    const connector = db.connectors.find(item => item.id === req.params.id)
    if (!connector || !authorizationFor(connector, employee, db).allowed) { res.status(403).json({ code: 'CONNECTOR_FORBIDDEN' }); return }
    const body = bodyRecord(req.body)
    if (typeof body?.name !== 'string' || !bodyRecord(body.arguments)
      || !Array.isArray(connector.tools) || !connector.tools.some(tool =>
        bodyRecord(tool)?.name === body.name && (!usesMallDataPermissions(connector) || bodyRecord(tool)?.allowed === true))) {
      res.status(403).json({ code: 'TOOL_FORBIDDEN', message: '此工具未授权' }); return
    }
    if (!connectorIsConfigured(connector) || !options.mcpTimeoutMs) {
      res.status(503).json({ code: 'MCP_NOT_CONFIGURED', message: 'MCP 连接参数尚未配置完整' }); return
    }
    const permissions = permissionsForEmployee(db, employee)
    const runtime = employeeRuntimeConnector(db, connector, employee.id, options)
    if (!runtime) { res.status(428).json({ code: 'ACCOUNT_REQUIRED' }); return }
    const query = usesMallDataPermissions(connector) ? restrictMallQuery(body.name, bodyRecord(body.arguments)!, permissions)
      : { arguments: bodyRecord(body.arguments)!, unavailableFloors: [] }
    if (usesMallDataPermissions(connector) && !mallArgumentsAllowed(body.name, query.arguments, permissions)) {
      res.status(403).json({ code: 'MCP_DATA_FORBIDDEN', message: '当前楼层权限不允许此工具或查询范围' }); return
    }
    const access = guardConnectorAccess(options.store, () => employeeForToken(options, req), connector.id, res)
    try {
      const batches = usesMallDataPermissions(connector)
        ? resolveMallCalls(body.name, query.arguments, permissions) : [query.arguments]
      const result = await withConfiguredConnectorMcp(runtime, options, async client => {
        const results: CallToolResult[] = []
        for (const args of batches) {
          access.assertCurrent()
          const result = CallToolResultSchema.parse(await client.callTool({ name: body.name as string, arguments: args }, CallToolResultSchema,
            { timeout: options.mcpTimeoutMs, signal: access.signal }))
          access.assertCurrent()
          if (result.isError) return result
          results.push(usesMallDataPermissions(connector) ? mallPublicResult(body.name as string, result, permissions) : result)
        }
        return results.length === 1 ? results[0]! : { content: results.flatMap(result => result.content) }
      }, access.signal)
      access.assertCurrent()
      res.setHeader('Cache-Control', 'no-store')
      res.json(query.unavailableFloors.length && !result.isError ? { ...result, content: [...result.content,
        { type: 'text', text: `已返回请求中有权限的楼层数据。${query.unavailableFloors.join('、')}未授权，无法获取，未向 MCP 查询这些楼层。请直接展示已获取结果并简要说明此限制。` },
      ] } : result)
    } catch (error) {
      if (access.signal.reason instanceof ConnectorAccessChanged) { res.status(403).json({ code: 'CONNECTOR_ACCESS_CHANGED', message: '连接器权限已变化，旧查询结果已丢弃，请重新查询' }); return }
      console.error('LFClaw MCP 调用失败:', error instanceof Error ? error.name : 'unknown')
      if (error instanceof ConnectorAuthorizationRequired) { res.status(428).json({ code: 'ACCOUNT_REQUIRED', message: '请重新连接账号' }); return }
      res.status(502).json({ code: 'MCP_UNAVAILABLE', message: 'MCP 服务暂不可用' })
    } finally { access.dispose() }
  })

  app.post('/api/employee/experts/:id/chat', async (req, res) => {
    const employee = employeeForToken(options, req)
    if (!employee) { res.status(401).json({ code: 'UNAUTHORIZED', message: '登录已失效或账号已停用' }); return }
    const body = bodyRecord(req.body)
    if (typeof body?.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 10_000
      || (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || body.sessionId.length > 200))) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '专家请求格式错误' }); return
    }
    const db = options.store.read()
    const expert = db.experts.find(item => item.id === req.params.id)
    if (!expert || !employeeCanUseExpert(expert, employee, db)) {
      res.status(403).json({ code: 'EXPERT_FORBIDDEN', message: '无权使用此专家' }); return
    }
    if (expert.source !== 'bailian' && expert.source !== 'dify' && expert.source !== 'weknora' || !options.expertTimeoutMs) {
      res.status(503).json({ code: 'EXPERT_NOT_READY', message: '此专家尚未接入服务端调用' }); return
    }
    try {
      const result = expert.source === 'bailian'
        ? await callBailianExpert(expert, body.prompt.trim(), body.sessionId as string | undefined, options.expertTimeoutMs)
        : expert.source === 'dify'
          ? await callDifyExpert(expert, body.prompt.trim(), body.sessionId as string | undefined,
            `lfclaw-${employee.id}`, options.expertTimeoutMs)
          : await callWeKnoraExpert(expert, body.prompt.trim(), body.sessionId as string | undefined,
            employee.id, options.expertTimeoutMs)
      res.json(result)
    } catch (error) {
      if (error instanceof WeKnoraSessionError) {
        res.status(400).json({ code: 'INVALID_EXPERT_SESSION', message: error.message }); return
      }
      console.error('LFClaw 远程专家调用失败:', error instanceof Error ? error.message : 'unknown')
      if (error instanceof WeKnoraTimeoutError) {
        res.status(504).json({ code: 'EXPERT_TIMEOUT', message: '远程专家响应超时，本次结果未返回；WeKnora 可能仍在处理，请稍后再试' }); return
      }
      if (error instanceof Error && error.message === '当前仅支持 Dify Chatbot 与 Chatflow 应用') {
        res.status(400).json({ code: 'EXPERT_UNSUPPORTED', message: error.message }); return
      }
      res.status(502).json({ code: 'EXPERT_UNAVAILABLE', message: '远程专家暂不可用，请检查平台配置、接口权限与服务状态' })
    }
  })

  app.post(['/api/employee/chat/completions', '/api/employee/v1/chat/completions'], async (req, res, next) => {
    const employee = employeeForToken(options, req)
    if (!employee) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '登录已失效或账号已停用' })
      return
    }
    const body = bodyRecord(req.body)
    const openai = req.path === '/api/employee/v1/chat/completions'
    const selectedModel = openai ? body?.model : body?.modelId
    if (typeof selectedModel !== 'string' || !validGatewayMessages(body?.messages)) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '模型请求格式错误' })
      return
    }
    const db = options.store.read()
    const model = db.models.find(item => item.id === selectedModel)
    if (!model || !authorizationFor(model, employee, db).allowed) {
      res.status(403).json({ code: 'MODEL_FORBIDDEN', message: '无权使用此模型' })
      return
    }
    const requestedTokens = openai ? body?.max_tokens ?? body?.max_completion_tokens : body?.maxTokens
    if (requestedTokens !== undefined && (typeof requestedTokens !== 'number' || !Number.isSafeInteger(requestedTokens) || requestedTokens <= 0)) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '最大输出 token 数必须为正整数' })
      return
    }
    const capacity = modelCapacity(model)
    const maxTokens = typeof requestedTokens === 'number' ? Math.min(requestedTokens, capacity.maxTokens) : capacity.maxTokens
    const pricing = pricingOf(model)
    const usageId = randomUUID()
    try {
      options.store.update(db => { db.modelUsage.unshift({ id: usageId, employeeId: employee.id,
        departmentId: employee.departmentId, modelId: model.id, createdAt: new Date().toISOString(),
        status: 'pending', inputTokens: null, outputTokens: null, totalTokens: null,
        inputRate: pricing?.inputRate ?? null, outputRate: pricing?.outputRate ?? null,
        currency: pricing?.currency ?? null, costStatus: 'unavailable', cost: null }) })
      const controller = new AbortController()
      const disconnected = () => { if (!res.writableEnded) controller.abort() }
      res.on('close', disconnected)
      const write = async (event: string) => {
        if (controller.signal.aborted) throw new Error('员工已停止请求')
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('X-Accel-Buffering', 'no')
          res.flushHeaders()
        }
        if (!res.write(event)) await once(res, 'drain', { signal: controller.signal })
      }
      let result: { status: number; body: unknown }
      try {
        result = await callModel(model, body?.messages, maxTokens, options.modelTimeoutMs,
          openai && body ? gatewayOptions(body) : {},
          openai && body?.stream === true ? { signal: controller.signal, write } : undefined)
      } finally { res.off('close', disconnected) }
      const usage = bodyRecord(bodyRecord(result.body)?.usage)
      options.store.update(db => {
        const entry = db.modelUsage.find(item => item.id === usageId)
        if (!entry) throw new StoreError('DATA_INVALID', '模型用量记录丢失')
        entry.status = result.status === 200 ? 'completed' : 'failed'
        entry.inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null
        entry.outputTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null
        entry.totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : null
        entry.cost = result.status === 200 ? costOf(pricing, entry.inputTokens, entry.outputTokens) : null
        entry.costStatus = entry.cost === null ? 'unavailable' : 'calculated'
      })
      if (res.headersSent) {
        if (!res.destroyed) {
          if (result.status !== 200) res.write(`data: ${JSON.stringify({ error: result.body })}\n\n`)
          res.end('data: [DONE]\n\n')
        }
      } else if (openai && body?.stream === true && result.status === 200) {
        const events = completionEvents(result.body, selectedModel, usageId)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(events)
      } else res.status(result.status).json(result.body)
    } catch (error) { next(error) }
  })

  app.post('/api/logout', (req, res) => {
    options.auth.logout(bearerToken(req))
    res.status(204).end()
  })

  app.use('/api/admin', requireAdmin(options.auth))
  app.get('/api/admin/usage', (req, res) => {
    const query = parseUsageReportQuery(req.query)
    if (!query) { res.status(400).json({ code: 'INVALID_INPUT', message: '用量统计筛选条件无效' }); return }
    res.setHeader('Cache-Control', 'no-store')
    res.json(usageReport(options.store.read(), query))
  })
  app.post('/api/admin/experts/import', (req, res, next) => {
    const body = bodyRecord(req.body)
    if (!body || typeof body.preview !== 'boolean') { res.status(400).json({ code: 'INVALID_EXPERT_IMPORT', message: '专家导入请求无效' }); return }
    try {
      if (body.preview) { res.json(resolveExpertImport(body.definition, options.store.read(), body)); return }
      const imported = options.store.update(db => {
        const result = resolveExpertImport(body.definition, db, body)
        const prior = db.experts.find(item => item.id === result.expert.id)
        db.experts = [...db.experts.filter(item => item.id !== result.expert.id), ...result.members, result.expert]
        recordOperation(db, `${prior ? 'update' : 'create'}:experts`, result.expert.id,
          resourceOperationSummary('experts', prior ? 'update' : 'create', result.expert, prior))
        return result
      })
      res.status(201).json(imported)
    } catch (error) {
      if (error instanceof ExpertImportError) res.status(400).json({ code: 'INVALID_EXPERT_IMPORT', message: error.message })
      else next(error)
    }
  })
  app.get('/api/admin/branding', (_req, res) => res.json(options.store.read().branding))
  app.put('/api/admin/branding', (req, res) => {
    const value: unknown = req.body
    if (!validBranding(value)) {
      res.status(400).json({ code: 'BRANDING_INVALID', message: '首页口号须为 1–40 字，标签最多 12 字，且不能换行；显示标签时文字不能为空' })
      return
    }
    const branding = { headline: value.headline.trim(), badge: value.badge.trim(), showBadge: value.showBadge }
    options.store.update(db => {
      const fields: string[] = []
      if (db.branding.headline !== branding.headline) fields.push('首页口号')
      if (db.branding.badge !== branding.badge) fields.push('标签文字')
      if (db.branding.showBadge !== branding.showBadge) fields.push(branding.showBadge ? '显示标签' : '隐藏标签')
      db.branding = branding
      recordOperation(db, 'update:branding', 'LFClaw', fields.length
        ? `已修改员工端首页文案：${fields.join('、')}` : '已保存员工端首页文案（内容未发生变化）')
    })
    res.json(branding)
  })
  app.get('/api/admin/personal-skills', (_req, res) => {
    const db = options.store.read()
    res.json(db.personalSkillReports.map(report => ({ ...report,
      employeeName: db.employees.find(employee => employee.id === report.ownerEmployeeId)?.name ?? report.ownerEmployeeId })))
  })

  app.post('/api/admin/password', (req, res) => {
    const body = bodyRecord(req.body)
    if (typeof body?.currentPassword !== 'string' || typeof body.nextPassword !== 'string'
      || body.nextPassword.length < 12 || body.nextPassword.length > 1024) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '新密码至少需要 12 个字符' })
      return
    }
    const token = options.auth.changePassword(body.currentPassword, body.nextPassword)
    if (!token) { res.status(401).json({ code: 'INVALID_CREDENTIALS', message: '当前密码错误' }); return }
    try {
      options.store.update(db => recordOperation(db, 'change:admin-password', 'admin', '修改管理员密码'))
      res.json({ token })
    } catch (error) {
      console.error('LFClaw 密码已修改，但操作日志写入失败:', error instanceof Error ? error.name : 'unknown')
      res.json({ token, warning: '密码已修改，但操作日志写入失败' })
    }
  })
  app.get('/api/admin/data', (_req, res) => res.json({ ...publicDatabase(options.store.read()), systemMetric: readSystemStatus(options.dataDirectory) }))
  app.get('/api/admin/status', (_req, res) => res.json(readSystemStatus(options.dataDirectory)))
  app.get('/api/admin/employees/:id/effective', (req, res) => {
    const db = options.store.read()
    const employee = db.employees.find(item => item.id === req.params.id)
    if (!employee) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    const resources = (['models', 'skills', 'connectors', 'experts'] as const).flatMap(collection =>
      db[collection].map(item => ({ collection, id: item.id, name: item.name,
        ...(collection === 'experts' ? { expertKind: item.source === 'team' ? 'team' : 'expert' } : {}),
        ...authorizationFor(item, employee, db),
        ...(collection === 'experts' && item.source === 'team'
          ? { allowed: employeeCanUseExpert(item, employee, db) } : {}),
        override: bodyRecord(item.employeeOverrides)?.[employee.id] ?? 'inherit',
      })))
    res.json({ employeeId: employee.id, resources })
  })
  app.get('/api/admin/employees/:id/mcp-permissions', (req, res) => {
    const db = options.store.read()
    const employee = db.employees.find(item => item.id === req.params.id)
    if (!employee) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.json({ employeeId: employee.id, permissions: permissionsForEmployee(db, employee) })
  })
  app.put('/api/admin/employees/:id/mcp-permissions', (req, res) => {
    const body = bodyRecord(req.body)
    if (!body || !Object.hasOwn(body, 'permissions') || !validMallPermissions(body.permissions)) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '请选择有效的商场 MCP 权限' }); return
    }
    const result = options.store.update(db => {
      const employee = db.employees.find(item => item.id === req.params.id)
      if (!employee) return null
      employee.mcpPermissions = body.permissions
      recordOperation(db, 'permission:mall-mcp', employee.id,
        `设置商场 MCP 权限：${(body.permissions as string[]).join('、') || '无'}`)
      return { employeeId: employee.id, permissions: permissionsForEmployee(db, employee) }
    })
    if (!result) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.json(result)
  })
  app.put('/api/admin/permissions/:collection/:resourceId/:employeeId', (req, res) => {
    const { collection, resourceId, employeeId } = req.params
    const decision = bodyRecord(req.body)?.decision
    if (!(['models', 'skills', 'connectors', 'experts'] as string[]).includes(collection)
      || (decision !== 'allow' && decision !== 'deny' && decision !== 'inherit')) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '资源类型或授权决定无效' }); return
    }
    const result = options.store.update(db => {
      const employee = db.employees.find(item => item.id === employeeId)
      const item = db[collection as 'models' | 'skills' | 'connectors' | 'experts'].find(value => value.id === resourceId)
      if (!employee || !item) return null
      const overrides = { ...bodyRecord(item.employeeOverrides) }
      if (decision === 'inherit') delete overrides[employeeId]
      else overrides[employeeId] = decision
      item.employeeOverrides = overrides
      const decisionLabel = { allow: '允许使用', deny: '禁止使用', inherit: '恢复继承授权' }[decision]
      recordOperation(db, `permission:${collection}`, resourceId,
        `已调整员工「${String(employee.name)}」对资源「${String(item.name)}」的授权：${decisionLabel}`)
      const effective = authorizationFor(item, employee, db)
      return collection === 'experts' && item.source === 'team'
        ? { ...effective, allowed: employeeCanUseExpert(item, employee, db) } : effective
    })
    if (!result) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.json({ employeeId, collection, resourceId, decision, ...result })
  })
  app.post('/api/admin/experts/:id/test', async (req, res) => {
    const expert = options.store.read().experts.find(item => item.id === req.params.id)
    if (!expert) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    if (expert.source !== 'bailian' && expert.source !== 'dify' && expert.source !== 'weknora' || !options.expertTimeoutMs) {
      res.status(503).json({ code: 'EXPERT_NOT_READY', message: '仅已接入的远程专家支持连接测试' }); return
    }
    try {
      const result = expert.source === 'bailian'
        ? await callBailianExpert(expert, '请回复 OK', undefined, options.expertTimeoutMs)
        : expert.source === 'dify'
          ? await callDifyExpert(expert, '请回复 OK', undefined, 'lfclaw-admin-test', options.expertTimeoutMs)
          : await callWeKnoraExpert(expert, '请回复 OK', undefined, 'lfclaw-admin-test', options.expertTimeoutMs)
      res.json({ ok: true, text: result.text })
    } catch (error) {
      console.error('LFClaw 远程专家测试失败:', error instanceof Error ? error.message : 'unknown')
      if (error instanceof WeKnoraTimeoutError) {
        res.status(504).json({ code: 'EXPERT_TIMEOUT', message: '远程专家测试超时，请稍后重试' }); return
      }
      if (error instanceof Error && error.message === '当前仅支持 Dify Chatbot 与 Chatflow 应用') {
        res.status(400).json({ code: 'EXPERT_UNSUPPORTED', message: error.message }); return
      }
      res.status(502).json({ code: 'EXPERT_UNAVAILABLE', message: '远程专家测试失败，请检查平台配置、接口权限与服务状态' })
    }
  })

  app.post('/api/admin/connectors/:id/test', async (req, res) => {
    const connector = options.store.read().connectors.find(item => item.id === req.params.id)
    if (!connector) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    if (connectorAuthentication(connector).type !== 'none' && connectorAuthentication(connector).owner === 'employee') {
      res.status(428).json({ code: 'ACCOUNT_REQUIRED', message: '此连接器由员工独立连接；请员工在客户端配置凭据或完成浏览器授权，发现的工具自动可用' }); return
    }
    if (!connectorIsConfigured(connector)) {
      res.status(503).json({ code: 'MCP_NOT_CONFIGURED', message: '请先填写 MCP 服务地址或 stdio 启动命令' }); return
    }
    if (!options.mcpTimeoutMs) { res.status(503).json({ code: 'MCP_NOT_CONFIGURED' }); return }
    const runtime = employeeRuntimeConnector(options.store.read(), connector, '$enterprise', options)
    if (!runtime) { res.status(428).json({ code: 'ACCOUNT_REQUIRED', message: '请先在“账号连接”中配置企业凭据或完成浏览器授权' }); return }
    try {
      if (!usesMallDataPermissions(connector)) {
        const tools = await discoverMcpTools(configuredMcpConnection(runtime, options.mcpTimeoutMs))
        res.json({ tools, verified: true }); return
      }
      const result = await withConfiguredConnectorMcp(runtime, options,
        client => client.listTools(undefined, { timeout: options.mcpTimeoutMs }))
      res.json({ tools: result.tools.map(tool => ({ name: tool.name, description: tool.description })), verified: true })
    } catch (error) {
      console.error('LFClaw MCP 测试失败:', error instanceof Error ? error.name : 'unknown')
      res.status(502).json({ code: 'MCP_UNAVAILABLE', message: '无法连接 MCP 服务，请检查地址或启动命令、传输方式与认证配置' })
    }
  })
  app.post('/api/admin/notifications', (req, res) => {
    const body = bodyRecord(req.body)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (!title || !content || title.length > 120 || content.length > 4000) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '通知标题或内容无效' })
      return
    }
    const notification = { id: randomUUID(), title, content, sentAt: new Date().toISOString() }
    options.store.update(db => {
      db.notifications.unshift(notification)
      recordOperation(db, 'create:notifications', notification.id, `已发布通知「${title}」`)
    })
    res.status(201).json(notification)
  })
  app.post('/api/admin/notifications/:id/revoke', (req, res) => {
    const existing = options.store.read().notifications.find(item => item.id === req.params.id)
    if (!existing) { res.status(404).json({ code: 'NOT_FOUND', message: '公告不存在' }); return }
    if (existing.revokedAt !== undefined) { res.json(existing); return }
    const notification = options.store.update(db => {
      const item = db.notifications.find(entry => entry.id === req.params.id)
      if (!item) return null
      if (item.revokedAt !== undefined) return item
      item.revokedAt = new Date().toISOString()
      recordOperation(db, 'revoke:notifications', item.id, `已撤回通知「${String(item.title)}」`)
      return item
    })
    if (!notification) { res.status(404).json({ code: 'NOT_FOUND', message: '公告不存在' }); return }
    res.json(notification)
  })
  app.delete('/api/admin/notifications/:id', (req, res) => {
    const existing = options.store.read().notifications.find(item => item.id === req.params.id)
    if (!existing) { res.status(404).json({ code: 'NOT_FOUND', message: '公告不存在' }); return }
    if (existing.revokedAt === undefined) {
      res.status(409).json({ code: 'NOT_REVOKED', message: '请先撤回公告再删除' }); return
    }
    const removed = options.store.update(db => {
      const index = db.notifications.findIndex(item => item.id === req.params.id && item.revokedAt !== undefined)
      if (index < 0) return false
      const item = db.notifications.splice(index, 1)[0]!
      recordOperation(db, 'delete:notifications', item.id, `已删除已撤回通知「${String(item.title)}」`)
      return true
    })
    if (!removed) { res.status(404).json({ code: 'NOT_FOUND', message: '公告不存在' }); return }
    res.status(204).end()
  })
  app.post('/api/admin/models/:id/test', (req, res) => {
    const model = options.store.read().models.find(item => item.id === req.params.id)
    if (!model) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    const start = Date.now()
    void callModel(model, [{ role: 'user', content: '请回复 OK' }], 5, options.modelTimeoutMs).then(result => {
      res.status(result.status).json({ ...bodyRecord(result.body), latencyMs: Date.now() - start })
    })
  })
  app.get('/api/admin/data/:collection', (req, res) => {
    const { collection } = req.params
    if (!isCollectionName(collection)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    res.json(options.store.read()[collection].map(item => sanitizeItem(collection, item)))
  })
  app.post('/api/admin/data/:collection', async (req, res, next) => {
    try {
    const { collection } = req.params
    if (!isMutableCollectionName(collection) || !isRecordItem(req.body)
      || (collection === 'models' && (!validPricing(req.body) || !validModelCapacity(req.body) || !validModelThinkingOption(req.body)))) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '集合或记录格式错误' })
      return
    }
    if (collection === 'connectors' && (!validConnectorPresentation(req.body) || !validConnectorConfiguration(req.body))) {
      res.status(400).json({ code: 'INVALID_CONNECTOR', message: '连接器配置无效；请检查地址或启动命令、参数数组、环境变量、Header 和图标。修改命令或参数后须重新填写环境变量值' }); return
    }
    if (collection === 'connectors' && !validConnectorScope(req.body, options.store.read())) {
      res.status(400).json({ code: 'INVALID_SCOPE', message: '请选择有效的连接器分配范围和目标' }); return
    }
    if (collection === 'experts' && !validExpert(req.body, options.store.read())) {
      res.status(400).json({ code: 'INVALID_EXPERT', message: '专家配置或分配范围无效' }); return
    }
    let skillArchive: ReturnType<typeof savedSkillArchive> | null = null
    if (collection === 'skills' && !validSkillPresentation(req.body)) { res.status(400).json({ code: 'INVALID_SKILL', message: '技能版本或图标格式无效，请使用 2MB 以内的 PNG/JPG' }); return }
    if (collection === 'skills') {
      try { skillArchive = savedSkillArchive(options.skillsDirectory, req.body, options.skillArchiveLimits) }
      catch (error) { res.status(400).json({ code: 'INVALID_SKILL', message: error instanceof Error ? error.message : '技能包无效' }); return }
    }
    if (collection === 'connectors') {
      const candidate = updatedItem(collection, undefined, req.body)
      if (!validMallConnectorAssignment(candidate, options.store.read())) {
        res.status(409).json({ code: 'MALL_CONNECTOR_CONFLICT', message: '商场数据权限只能开启一个连接器，请先关闭原连接器的开关' }); return
      }
      if (!await verifyChangedMallConfiguration(candidate, undefined, options, res)) return
      if (!validMallConnectorAssignment(candidate, options.store.read())) {
        res.status(409).json({ code: 'MALL_CONNECTOR_CONFLICT', message: '商场数据权限只能开启一个连接器，请先关闭原连接器的开关' }); return
      }
    }
    const item = options.store.update(db => {
      if (db[collection].some(existing => existing.id === req.body.id)) return null
      const created = collection === 'skills' && skillArchive
        ? updatedSkill(undefined, req.body, skillArchive, options.skillsDirectory, options.skillArchiveLimits) : updatedItem(collection, undefined, req.body)
      if (collection === 'models' && created.isDefault === true) {
        for (const model of db.models) model.isDefault = false
      }
      db[collection].push(created)
      recordOperation(db, `create:${collection}`, created.id, resourceOperationSummary(collection, 'create', created))
      return created
    })
    if (!item) {
      res.status(409).json({ code: 'DUPLICATE_ID', message: '记录 ID 已存在' })
      return
    }
    res.status(201).json(sanitizeItem(collection, item))
    } catch (error) { next(error) }
  })
  app.put('/api/admin/data/:collection/:id', async (req, res, next) => {
    try {
    const { collection, id } = req.params
    if (!isMutableCollectionName(collection) || !isRecordItem(req.body) || req.body.id !== id
      || (collection === 'models' && (!validPricing(req.body) || !validModelCapacity({ ...options.store.read().models.find(item => item.id === id), ...req.body })
        || !validModelThinkingOption({ ...options.store.read().models.find(item => item.id === id), ...req.body })))) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '集合或记录格式错误' })
      return
    }
    if (collection === 'connectors' && (!validConnectorPresentation(req.body)
      || !validConnectorConfiguration(req.body, options.store.read().connectors.find(item => item.id === id)))) {
      res.status(400).json({ code: 'INVALID_CONNECTOR', message: '连接器配置无效；请检查地址或启动命令、参数数组、环境变量、Header 和图标。修改命令或参数后须重新填写环境变量值' }); return
    }
    if (collection === 'connectors' && !validConnectorScope(req.body, options.store.read())) {
      res.status(400).json({ code: 'INVALID_SCOPE', message: '请选择有效的连接器分配范围和目标' }); return
    }
    if (collection === 'experts' && !validExpert(req.body, options.store.read(),
      options.store.read().experts.find(item => item.id === id))) {
      res.status(400).json({ code: 'INVALID_EXPERT', message: '专家配置或分配范围无效' }); return
    }
    let skillArchive: ReturnType<typeof savedSkillArchive> | null = null
    if (collection === 'skills' && !validSkillPresentation(req.body)) { res.status(400).json({ code: 'INVALID_SKILL', message: '技能版本或图标格式无效，请使用 2MB 以内的 PNG/JPG' }); return }
    if (collection === 'skills') {
      try { skillArchive = savedSkillArchive(options.skillsDirectory, req.body, options.skillArchiveLimits) }
      catch (error) { res.status(400).json({ code: 'INVALID_SKILL', message: error instanceof Error ? error.message : '技能包无效' }); return }
    }
    if (collection === 'connectors') {
      const prior = options.store.read().connectors.find(item => item.id === id)
      if (!prior) { res.status(404).json({ code: 'NOT_FOUND' }); return }
      const candidate = updatedItem(collection, prior, req.body)
      if (!validMallConnectorAssignment(candidate, options.store.read())) {
        res.status(409).json({ code: 'MALL_CONNECTOR_CONFLICT', message: '商场数据权限只能开启一个连接器，请先关闭原连接器的开关' }); return
      }
      if (!await verifyChangedMallConfiguration(candidate, prior, options, res)) return
      if (!validMallConnectorAssignment(candidate, options.store.read())) {
        res.status(409).json({ code: 'MALL_CONNECTOR_CONFLICT', message: '商场数据权限只能开启一个连接器，请先关闭原连接器的开关' }); return
      }
    }
    const item = options.store.update(db => {
      const index = db[collection].findIndex(existing => existing.id === id)
      if (index < 0) return null
      const prior = db[collection][index]
      const next = collection === 'skills' && skillArchive
        ? updatedSkill(prior, req.body, skillArchive, options.skillsDirectory, options.skillArchiveLimits) : updatedItem(collection, prior, req.body)
      if (collection === 'models' && next.isDefault === true) {
        for (const model of db.models) if (model.id !== id) model.isDefault = false
      }
      db[collection][index] = next
      recordOperation(db, `update:${collection}`, id, resourceOperationSummary(collection, 'update', next, prior))
      return { prior, next }
    })
    if (!item) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    if (collection === 'employees' && item.prior.activationCode !== item.next.activationCode) options.auth.invalidateEmployee(id)
    res.json(sanitizeItem(collection, item.next))
    } catch (error) { next(error) }
  })
  app.delete('/api/admin/data/:collection/:id', (req, res) => {
    const { collection, id } = req.params
    if (!isMutableCollectionName(collection)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    if (collection === 'experts' && options.store.read().experts.some(item =>
      item.source === 'team' && Array.isArray(item.memberIds) && item.memberIds.includes(id))) {
      res.status(409).json({ code: 'EXPERT_IN_TEAM', message: '请先从专家团中移除此专家' }); return
    }
    const removed = options.store.update(db => {
      const index = db[collection].findIndex(item => item.id === id)
      if (index < 0) return false
      const removed = db[collection].splice(index, 1)[0]!
      if (collection === 'employees' || collection === 'connectors') {
        db.connectorAccounts = db.connectorAccounts.filter(account =>
          collection === 'employees' ? account.employeeId !== id : account.connectorId !== id)
      }
      recordOperation(db, `delete:${collection}`, id, resourceOperationSummary(collection, 'delete', removed))
      return true
    })
    if (!removed) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    if (collection === 'employees') options.auth.invalidateEmployee(id)
    res.status(204).end()
  })
  app.post('/api/admin/employees/:id/reset-code', (req, res) => {
    const code = options.store.update(db => {
      const employee = db.employees.find(item => item.id === req.params.id)
      if (!employee) return null
      employee.activationCode = issueActivationCode(String(employee.name))
      recordOperation(db, 'reset:activation', employee.id, `已重置员工「${String(employee.name)}」的激活码`)
      return employee.activationCode
    })
    if (!code) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    options.auth.invalidateEmployee(req.params.id)
    res.json({ activationCode: code })
  })

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
  app.post('/api/admin/backups', (_req, res) => {
    res.status(201).json(createBackup(options.store, options.dataDirectory))
  })
  app.get('/api/admin/backups/:id/download', (req, res) => {
    const { id } = req.params
    if (!/^[0-9a-f-]{36}$/.test(id) || !options.store.read().backups.some(item => item.id === id)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    try {
      const archive = publicBackupArchive(readFileSync(join(options.dataDirectory, 'backups', `${id}.zip`)))
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`)
      res.send(Buffer.from(archive))
    } catch (error) {
      console.error('LFClaw 备份下载失败:', error instanceof Error ? error.name : 'unknown')
      res.status(500).json({ code: 'BACKUP_UNAVAILABLE', message: '备份文件读取或校验失败' })
    }
  })
  app.delete('/api/admin/backups/:id', (req, res) => {
    const { id } = req.params
    const current = options.store.read()
    const record = /^[0-9a-f-]{36}$/.test(id) ? current.backups.find(item => item.id === id) : undefined
    if (!record) { res.status(404).json({ code: 'NOT_FOUND', message: '备份记录不存在' }); return }
    const directory = join(options.dataDirectory, 'backups')
    const original = join(directory, `${id}.zip`)
    const staged = join(directory, `.deleting-${randomUUID()}.zip`)
    const operationId = randomUUID()
    let moved = false
    let committed = false
    try {
      if (existsSync(original)) { renameSync(original, staged); moved = true }
      options.store.update(db => {
        const index = db.backups.findIndex(item => item.id === id)
        if (index < 0) throw new StoreError('DATA_INVALID', '备份记录在删除期间发生变化')
        db.backups.splice(index, 1)
        db.operationLogs.unshift({ id: operationId, time: new Date().toISOString(),
          type: 'delete:backups', object: id, change: `已删除备份「${String(record.name)}」`, operator: 'admin' })
      })
      committed = true
      if (moved) unlinkSync(staged)
      res.status(204).end()
    } catch (error) {
      try {
        if (moved && existsSync(staged)) renameSync(staged, original)
        if (committed) options.store.update(db => {
          if (!db.backups.some(item => item.id === id)) {
            const index = current.backups.findIndex(item => item.id === id)
            db.backups.splice(index, 0, record)
          }
          db.operationLogs = db.operationLogs.filter(item => item.id !== operationId)
        })
      } catch (rollbackError) {
        console.error('LFClaw 备份删除回滚失败:', rollbackError instanceof Error ? rollbackError.name : 'unknown')
        res.status(500).json({ code: 'BACKUP_DELETE_UNKNOWN', message: '备份删除结果未确定，请刷新页面并检查备份记录' })
        return
      }
      console.error('LFClaw 备份删除失败:', error instanceof Error ? error.name : 'unknown')
      res.status(503).json({ code: 'BACKUP_DELETE_FAILED', message: '备份删除失败，原备份已保留' })
    }
  })
  app.post('/api/admin/backups/:id/restore', (req, res) => {
    const { id } = req.params
    if (!/^[0-9a-f-]{36}$/.test(id) || !options.store.read().backups.some(item => item.id === id)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    try {
      restoreBackup(readFileSync(join(options.dataDirectory, 'backups', `${id}.zip`)), options.store, options.dataDirectory)
      res.status(204).end()
    } catch (error) {
      res.status(400).json({ code: 'INVALID_BACKUP', message: error instanceof Error ? error.message : '备份恢复失败' })
    }
  })
  const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })
  app.post('/api/admin/backups/restore', restoreUpload.single('file'), (req, res) => {
    if (!req.file || !req.file.originalname.toLowerCase().endsWith('.zip')) {
      res.status(400).json({ code: 'INVALID_BACKUP', message: '请选择 ZIP 备份文件' })
      return
    }
    try {
      restoreBackup(new Uint8Array(req.file.buffer), options.store, options.dataDirectory)
      res.status(204).end()
    } catch (error) {
      res.status(400).json({ code: 'INVALID_BACKUP', message: error instanceof Error ? error.message : '备份恢复失败' })
    }
  })
  const skillUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: options.skillArchiveLimits.maxArchiveBytes } })
  app.post('/api/admin/skills/upload', skillUpload.single('file'), (req, res) => {
    if (!req.file || !req.file.originalname.toLowerCase().endsWith('.zip')) {
      res.status(400).json({ code: 'INVALID_ZIP', message: '请选择 ZIP 文件' })
      return
    }
    let description: string
    try {
      description = skillDescription(new Uint8Array(req.file.buffer), options.skillArchiveLimits)
    } catch (error) {
      res.status(400).json({ code: 'INVALID_SKILL', message: error instanceof Error ? error.message : 'ZIP 文件无效' })
      return
    }
    mkdirSync(options.skillsDirectory, { recursive: true })
    const filename = `${randomUUID()}.zip`
    writeFileSync(join(options.skillsDirectory, filename), req.file.buffer, { mode: 0o600, flag: 'wx' })
    res.status(201).json({ path: filename, description, originalName: req.file.originalname, size: req.file.size })
  })
  app.get('/api/admin/skills/:id/versions', (req, res) => {
    const skill = options.store.read().skills.find(item => item.id === req.params.id)
    if (!skill) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    try {
      const history = skillHistory(skill, options.skillsDirectory, options.skillArchiveLimits)
      res.json({ skillId: skill.id, currentRevision: history.at(-1)!.revision,
        versions: history.map(({ zipPath, ...visible }) => visible).reverse() })
    } catch (error) {
      console.error('LFClaw 技能版本读取失败:', error instanceof Error ? error.name : 'unknown')
      res.status(503).json({ code: 'SKILL_HISTORY_UNAVAILABLE', message: '技能版本记录暂不可用' })
    }
  })
  app.post('/api/admin/skills/:id/rollback', (req, res) => {
    const revision = bodyRecord(req.body)?.revision
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '请选择有效的历史版本' }); return
    }
    const skill = options.store.read().skills.find(item => item.id === req.params.id)
    if (!skill) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    let history: SkillVersionRecord[]
    try { history = skillHistory(skill, options.skillsDirectory, options.skillArchiveLimits) }
    catch (error) {
      console.error('LFClaw 技能版本读取失败:', error instanceof Error ? error.name : 'unknown')
      res.status(503).json({ code: 'SKILL_HISTORY_UNAVAILABLE', message: '技能版本记录暂不可用' }); return
    }
    const target = history.find(item => item.revision === revision)
    if (!target || target.revision === history.at(-1)?.revision) {
      res.status(409).json({ code: 'SKILL_REVISION_UNAVAILABLE', message: '该历史版本不存在或已是当前版本' }); return
    }
    try {
      const archive = savedSkillArchive(options.skillsDirectory, { id: skill.id, zipPath: target.zipPath }, options.skillArchiveLimits)
      if (archive.sha256 !== target.sha256 || archive.description !== target.description) {
        res.status(409).json({ code: 'SKILL_INTEGRITY_ERROR', message: '历史技能包校验失败，未执行回滚' }); return
      }
    } catch (error) {
      console.error('LFClaw 历史技能包读取失败:', error instanceof Error ? error.name : 'unknown')
      res.status(409).json({ code: 'SKILL_INTEGRITY_ERROR', message: '历史技能包不可用，未执行回滚' }); return
    }
    const nextRevision = history.at(-1)!.revision + 1
    const nextVersion: SkillVersionRecord = { ...target, revision: nextRevision, version: String(nextRevision),
      createdAt: new Date().toISOString(), restoredFromRevision: target.revision }
    const result = options.store.update(db => {
      const current = db.skills.find(item => item.id === skill.id)
      if (!current) return null
      current.zipPath = target.zipPath
      current.description = target.description
      current.sha256 = target.sha256
      current.revision = nextRevision
      current.version = nextVersion.version
      current.history = [...history, nextVersion]
      recordOperation(db, 'rollback:skills', current.id, `已回退技能「${String(current.name)}」到版本 ${target.version}，发布修订 ${nextVersion.version}`)
      return current
    })
    if (!result) { res.status(404).json({ code: 'NOT_FOUND' }); return }
    res.json(sanitizeItem('skills', result))
  })
  app.get('/api/admin/skills/:filename/download', (req, res) => {
    const filename = req.params.filename
    if (basename(filename) !== filename || !/^[0-9a-f-]{36}\.zip$/.test(filename)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    const filePath = join(options.skillsDirectory, filename)
    if (!existsSync(filePath)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(statSync(filePath).size))
    createReadStream(filePath).pipe(res)
  })

  const errors: ErrorRequestHandler = (error: unknown, _req: Request, res: Response, _next) => {
    if (res.headersSent) return
    if (error instanceof multer.MulterError) {
      res.status(400).json({ code: 'UPLOAD_INVALID', message: '上传文件超出限制或格式错误' })
      return
    }
    if (error instanceof StoreError) {
      res.status(503).json({ code: error.code, message: '数据存储不可用；原文件已保留，请联系管理员检查' })
      return
    }
    console.error('LFClaw server error:', error)
    res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务处理失败，请稍后重试' })
  }
  app.use(errors)
  return app
}
