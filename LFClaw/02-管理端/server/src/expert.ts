/** 企业远程专家的配置校验和服务端调用。 */
import type { Database, RecordItem } from './store.ts'
import { validExpertCapabilities } from './expert-definition.ts'
import { validWeKnoraUrl } from './weknora.ts'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** 检查发布专家所需的授权范围和远程应用配置。 */
export function validExpert(input: RecordItem, db: Database, prior?: RecordItem): boolean {
  if (!validExpertCapabilities(input)) return false
  for (const [key, collection] of [['skillIds', 'skills'], ['connectorIds', 'connectors']] as const) {
    if (Array.isArray(input[key]) && !input[key].every(id => db[collection].some(item => item.id === id))) return false
  }
  if (typeof input.name !== 'string' || !input.name.trim() || typeof input.description !== 'string'
    || typeof input.enabled !== 'boolean' || !Array.isArray(input.tags)
    || !input.tags.every(tag => typeof tag === 'string') || !['dsh', 'bailian', 'dify', 'weknora', 'external', 'team'].includes(String(input.source))) return false
  if ((input.scope === 'all' || input.scope === 'none')) {
    if (!Array.isArray(input.scopeTarget) || input.scopeTarget.length !== 0) return false
  } else {
    if (input.scope !== 'department' && input.scope !== 'employee') return false
    if (!Array.isArray(input.scopeTarget) || input.scopeTarget.length === 0
      || !input.scopeTarget.every((id): id is string => typeof id === 'string')
      || new Set(input.scopeTarget).size !== input.scopeTarget.length) return false
    const candidates = input.scope === 'department' ? db.departments : db.employees
    if (!input.scopeTarget.every(id => candidates.some(item => item.id === id))) return false
  }
  if (input.source === 'team') return typeof input.instructions === 'string' && !!input.instructions.trim()
    && input.instructions.length <= 4000 && Array.isArray(input.memberIds) && input.memberIds.length >= 2 && input.memberIds.length <= 10
    && input.memberIds.every((id): id is string => typeof id === 'string')
    && new Set(input.memberIds).size === input.memberIds.length
    && input.memberIds.every(id => db.experts.some(item => item.id === id && item.source !== 'team'))
  if (input.source === 'dsh') return typeof input.instructions === 'string'
    && !!input.instructions.trim() && input.instructions.length <= 4000
  const config = record(input.externalConfig)
  const oldConfig = prior && prior.source === input.source ? record(prior.externalConfig) : null
  if (input.source === 'external') return !!config && typeof config.apiUrl === 'string'
    && /^https:\/\//.test(config.apiUrl) && typeof config.apiKey === 'string'
    && (!!config.apiKey || typeof oldConfig?.apiKey === 'string' && !!oldConfig.apiKey)
  if (input.source === 'dify') return !!config && validDifyUrl(config.apiUrl)
    && typeof config.apiKey === 'string' && (!!config.apiKey || typeof oldConfig?.apiKey === 'string' && !!oldConfig.apiKey)
    && validDifyInputs(config.inputs)
  if (input.source === 'weknora') return !!config
    && validWeKnoraUrl(config.apiUrl)
    && typeof config.agentId === 'string' && !!config.agentId.trim() && config.agentId.length <= 200
    && typeof config.apiKey === 'string' && (!!config.apiKey || typeof oldConfig?.apiKey === 'string' && !!oldConfig.apiKey)
  return !!config && typeof config.appId === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(config.appId)
    && typeof config.apiKey === 'string' && (!!config.apiKey || typeof oldConfig?.apiKey === 'string' && !!oldConfig.apiKey)
    && (config.workspaceId === undefined || typeof config.workspaceId === 'string'
      && (!config.workspaceId || /^[A-Za-z0-9_-]{1,128}$/.test(config.workspaceId)))
}

function validDifyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
      && !url.search && !url.hash && url.pathname.replace(/\/$/u, '').endsWith('/v1')
  } catch { return false }
}

function validDifyInputs(value: unknown): boolean {
  const inputs = value === undefined ? {} : record(value)
  return !!inputs && Object.keys(inputs).length <= 30 && JSON.stringify(inputs).length <= 4000
}

/** Call a Dify Chatbot or Chatflow app after checking its published app mode. */
export async function callDifyExpert(expert: RecordItem, prompt: string, sessionId: string | undefined,
  user: string, timeoutMs: number): Promise<{ text: string; sessionId?: string }> {
  const config = record(expert.externalConfig)
  if (expert.source !== 'dify' || !config || !validDifyUrl(config.apiUrl)
    || typeof config.apiKey !== 'string' || !config.apiKey || !validDifyInputs(config.inputs))
    throw new Error('Dify 专家配置不完整')
  const base = config.apiUrl.replace(/\/$/u, '')
  const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }
  const signal = AbortSignal.timeout(timeoutMs)
  const info = await fetch(`${base}/info`, { headers, signal })
  if (!info.ok) throw new Error(`Dify 应用信息返回 HTTP ${info.status}`)
  const app: unknown = await info.json()
  const mode = record(app)?.mode
  if (mode !== 'chat' && mode !== 'advanced-chat') throw new Error('当前仅支持 Dify Chatbot 与 Chatflow 应用')
  const response = await fetch(`${base}/chat-messages`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ inputs: config.inputs ?? {}, query: prompt, user,
      response_mode: 'blocking', conversation_id: sessionId ?? '' }),
  })
  if (!response.ok) throw new Error(`Dify 对话返回 HTTP ${response.status}`)
  const result: unknown = await response.json()
  const output = record(result)
  if (!output || output.event !== 'message' || typeof output.answer !== 'string'
    || typeof output.conversation_id !== 'string') throw new Error('Dify 应用未返回有效文本或会话 ID')
  return { text: output.answer, sessionId: output.conversation_id }
}

/** 通过服务端密钥调用已发布的百炼应用；响应仅返回文本和会话 ID。 */
export async function callBailianExpert(expert: RecordItem, prompt: string, sessionId: string | undefined,
  timeoutMs: number): Promise<{ text: string; sessionId?: string; inputTokens?: number; outputTokens?: number }> {
  const config = record(expert.externalConfig)
  if (expert.source !== 'bailian' || !config || typeof config.appId !== 'string'
    || typeof config.apiKey !== 'string' || !config.apiKey) throw new Error('百炼专家配置不完整')
  const endpoint = `https://dashscope.aliyuncs.com/api/v1/apps/${encodeURIComponent(config.appId)}/completion`
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
      ...(typeof config.workspaceId === 'string' && config.workspaceId ? { 'X-DashScope-WorkSpace': config.workspaceId } : {}) },
    body: JSON.stringify({ input: { prompt, ...(sessionId ? { session_id: sessionId } : {}) }, parameters: {} }),
  })
  if (!response.ok) throw new Error(`百炼应用返回 HTTP ${response.status}`)
  const result: unknown = await response.json()
  const output = record(record(result)?.output)
  const usage = record(record(result)?.usage)
  if (!output || typeof output.text !== 'string') throw new Error('百炼应用未返回有效文本')
  return { text: output.text,
    ...(typeof output.session_id === 'string' ? { sessionId: output.session_id } : {}),
    ...(typeof usage?.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage?.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}) }
}
