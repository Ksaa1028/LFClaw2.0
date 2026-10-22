import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callWeKnoraExpert, validWeKnoraUrl, WeKnoraTimeoutError } from '../src/weknora.ts'

const expert = { id: 'wk-1', name: '知识顾问', source: 'weknora',
  externalConfig: { apiUrl: 'https://weknora.example.com/api/v1', apiKey: 'sk-test', agentId: 'agent-1' } }

function stream(...events: Array<Record<string, unknown>>): Response {
  return new Response(events.map(event => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } })
}

test('WeKnora Agent 创建会话、汇总正式回答，并绑定后续会话到员工', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    if (String(input).endsWith('/sessions')) return Response.json({ success: true, data: { id: 'session-1' } }, { status: 201 })
    return stream({ response_type: 'thinking', content: '内部思考', done: false },
      { response_type: 'answer', content: '第一段', done: false },
      { response_type: 'answer', content: '第二段', done: true },
      { response_type: 'complete', content: '', done: true })
  }
  try {
    const first = await callWeKnoraExpert(expert, '问题一', undefined, 'employee-1', 10_000)
    assert.equal(first.text, '第一段第二段')
    assert.match(first.sessionId, /^wk1\./)
    assert.equal(calls[0]?.headers.get('X-API-Key'), 'sk-test')
    assert.deepEqual(calls[1]?.body, { query: '问题一', agent_enabled: true, agent_id: 'agent-1' })
    const second = await callWeKnoraExpert(expert, '问题二', first.sessionId, 'employee-1', 10_000)
    assert.equal(second.text, '第一段第二段')
    assert.equal(calls.length, 3)
    assert.equal(calls[2]?.url, 'https://weknora.example.com/api/v1/agent-chat/session-1')
    await assert.rejects(callWeKnoraExpert(expert, '跨员工复用', first.sessionId, 'employee-2', 10_000), /不匹配/)
    await assert.rejects(callWeKnoraExpert({ ...expert, externalConfig: { ...expert.externalConfig, agentId: 'agent-2' } },
      '换配置后续聊', first.sessionId, 'employee-1', 10_000), /不匹配/)
    assert.equal(calls.length, 3)
    await callWeKnoraExpert({ ...expert, externalConfig: {
      ...expert.externalConfig, apiUrl: 'http://8.216.38.213:8089/api/v1',
    } }, 'HTTP 地址调用', undefined, 'employee-1', 10_000)
    assert.equal(calls[3]?.url, 'http://8.216.38.213:8089/api/v1/sessions')
    assert.equal(calls[3]?.headers.get('X-API-Key'), 'sk-test')
    assert.equal(calls[4]?.url, 'http://8.216.38.213:8089/api/v1/agent-chat/session-1')
  } finally { globalThis.fetch = originalFetch }
})

test('WeKnora 接受 HTTP 地址并拒绝无效地址、错误事件和缺少 complete 的结果', async () => {
  assert.equal(validWeKnoraUrl('http://8.216.38.213:8089/api/v1'), true)
  assert.equal(validWeKnoraUrl('http://weknora.example.com/api/v1?key=x'), false)
  assert.equal(validWeKnoraUrl('http://localhost:8080/api/v1'), true)
  assert.equal(validWeKnoraUrl('https://weknora.example.com/api/v1?key=x'), false)
  assert.equal(validWeKnoraUrl('https://weknora.example.com/api/v1'), true)
  assert.equal(validWeKnoraUrl('ftp://weknora.example.com/api/v1'), false)
  const originalFetch = globalThis.fetch
  let events: Array<Record<string, unknown>> = []
  globalThis.fetch = async input => String(input).endsWith('/sessions')
    ? Response.json({ success: true, data: { id: 'session-2' } }, { status: 201 }) : stream(...events)
  try {
    events = [{ response_type: 'answer', content: '部分结果' }, { response_type: 'error', content: '失败', done: true }]
    await assert.rejects(callWeKnoraExpert(expert, '问题', undefined, 'employee-1', 10_000), /错误事件/)
    events = [{ response_type: 'answer', content: '未完成结果', done: true }]
    await assert.rejects(callWeKnoraExpert(expert, '问题', undefined, 'employee-1', 10_000), /未正常完成/)
  } finally { globalThis.fetch = originalFetch }
})

test('WeKnora 超时返回可识别的失败类型', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) { reject(new Error('missing signal')); return }
    if (signal.aborted) { reject(signal.reason); return }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  try {
    await assert.rejects(callWeKnoraExpert(expert, '等待超时', undefined, 'employee-1', 20), WeKnoraTimeoutError)
  } finally { globalThis.fetch = originalFetch }
})
