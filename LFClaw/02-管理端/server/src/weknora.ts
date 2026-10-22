/** WeKnora Agent 的会话创建、SSE 回答与本地会话归属校验。 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { RecordItem } from './store.ts'

interface WeKnoraConfig { apiUrl: string; agentId: string; apiKey: string }

/** 续聊标识不符合当前员工和专家配置。 */
export class WeKnoraSessionError extends Error {}

/** WeKnora 未能在配置的等待时间内完成调用。 */
export class WeKnoraTimeoutError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** 校验 WeKnora API 基础地址，接受 HTTP 与 HTTPS。 */
export function validWeKnoraUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !!url.hostname && !url.username && !url.password
      && !url.search && !url.hash && url.pathname.replace(/\/$/u, '').endsWith('/api/v1')
  } catch { return false }
}

/** 校验 WeKnora Agent 接入参数。 */
export function validWeKnoraConfig(value: unknown): value is WeKnoraConfig {
  const config = record(value)
  return !!config && validWeKnoraUrl(config.apiUrl)
    && typeof config.agentId === 'string' && !!config.agentId.trim() && config.agentId.length <= 200
    && typeof config.apiKey === 'string' && !!config.apiKey
}

function sessionProof(expert: RecordItem, apiKey: string, user: string, rawId: string): string {
  const config = record(expert.externalConfig)
  return createHmac('sha256', apiKey).update(JSON.stringify([expert.id, config?.apiUrl, config?.agentId, user, rawId])).digest('base64url')
}

function encodeSession(expert: RecordItem, apiKey: string, user: string, rawId: string): string {
  return `wk1.${Buffer.from(rawId).toString('base64url')}.${sessionProof(expert, apiKey, user, rawId)}`
}

function decodeSession(expert: RecordItem, apiKey: string, user: string, sessionId: string): string {
  const match = /^wk1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(sessionId)
  if (!match) throw new WeKnoraSessionError('WeKnora 会话标识无效，请重新开始对话')
  const rawId = Buffer.from(match[1], 'base64url').toString('utf8')
  if (!rawId || rawId.length > 100) throw new WeKnoraSessionError('WeKnora 会话标识无效，请重新开始对话')
  const received = Buffer.from(match[2], 'base64url')
  const expected = Buffer.from(sessionProof(expert, apiKey, user, rawId), 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new WeKnoraSessionError('WeKnora 会话与当前员工或专家配置不匹配')
  return rawId
}

async function readAnswer(response: Response): Promise<string> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('WeKnora 未返回事件流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let answer = ''
  let receivedBytes = 0
  let completed = false
  try {
    while (!completed) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > 8 * 1024 * 1024) throw new Error('WeKnora 回答超出大小限制')
      pending += decoder.decode(value, { stream: true })
      if (pending.length > 8 * 1024 * 1024) throw new Error('WeKnora 事件超出大小限制')
      pending = pending.replace(/\r\n/gu, '\n')
      let boundary = pending.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        const data = frame.split('\n').filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n')
        if (data) {
          const event: unknown = JSON.parse(data)
          const parsed = record(event)
          if (!parsed || typeof parsed.response_type !== 'string') throw new Error('WeKnora 事件格式无效')
          if (parsed.response_type === 'error') throw new Error('WeKnora 对话返回错误事件')
          if (parsed.response_type === 'answer') {
            if (typeof parsed.content !== 'string') throw new Error('WeKnora 回答格式无效')
            answer += parsed.content
            if (answer.length > 200_000) throw new Error('WeKnora 回答超出长度限制')
          }
          if (parsed.response_type === 'complete') { completed = true; break }
        }
        boundary = pending.indexOf('\n\n')
      }
    }
  } finally { await reader.cancel().catch(() => undefined) }
  if (!completed || !answer.trim()) throw new Error('WeKnora 回答未正常完成')
  return answer
}

/** 用服务端 API Key 调用 WeKnora Agent；仅在 complete 后返回正式回答。 */
export async function callWeKnoraExpert(expert: RecordItem, prompt: string, sessionId: string | undefined,
  user: string, timeoutMs: number): Promise<{ text: string; sessionId: string }> {
  const config = record(expert.externalConfig)
  if (expert.source !== 'weknora' || !validWeKnoraConfig(config)) throw new Error('WeKnora 专家配置不完整')
  const apiUrl = String(config.apiUrl).replace(/\/$/u, '')
  const apiKey = String(config.apiKey)
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    let rawId = sessionId ? decodeSession(expert, apiKey, user, sessionId) : ''
    if (!rawId) {
      const created = await fetch(`${apiUrl}/sessions`, {
        method: 'POST', headers, signal, body: JSON.stringify({ title: String(expert.name).slice(0, 100) }),
      })
      if (!created.ok) throw new Error(`WeKnora 创建会话返回 HTTP ${created.status}`)
      const result: unknown = await created.json()
      const data = record(record(result)?.data)
      if (record(result)?.success !== true || typeof data?.id !== 'string' || !data.id || data.id.length > 100)
        throw new Error('WeKnora 未返回有效会话 ID')
      rawId = data.id
    }
    const response = await fetch(`${apiUrl}/agent-chat/${encodeURIComponent(rawId)}`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ query: prompt, agent_enabled: true, agent_id: String(config.agentId) }),
    })
    if (!response.ok) throw new Error(`WeKnora Agent 返回 HTTP ${response.status}`)
    return { text: await readAnswer(response), sessionId: encodeSession(expert, apiKey, user, rawId) }
  } catch (error) {
    if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError')
      throw new WeKnoraTimeoutError('WeKnora 响应超时', { cause: error })
    throw error
  }
}
