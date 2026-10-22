import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { EnterpriseModels } from '../src/models.ts'
import type { ActivationStorage } from '../src/enterprise.ts'
import { completionEvents } from '../../../../LFClaw/02-管理端/server/src/model-gateway.ts'
afterEach(() => vi.unstubAllGlobals())
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of stream) values.push(value)
  return values
}
it('目录只返回企业授权模型，撤权后拒绝旧模型，员工令牌仅发往企业网关', async () => {
  let authorized = true
  let maxTokens = 32768
  let contextWindow = 131072
  const paths: string[] = []
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (req, res) => {
    paths.push(req.url ?? '')
    expect(req.headers.authorization).toBe('Bearer employee-private-token')
    if (req.url === '/api/employee/me') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          models: authorized
            ? [
              {
                id: 'm1',
                name: '企业千问',
                type: 'text',
                protocol: 'openai-compatible',
                isDefault: true,
                contextWindow,
                maxTokens,
              },
            ]
            : [],
        }),
      )
    } else {
      res.setHeader('Content-Type', 'text/event-stream')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const request = JSON.parse(Buffer.concat(chunks).toString())
      requests.push(request)
      const message = request.tools?.length
        ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-test', type: 'function', function: { name: 'read_document', arguments: '{"path":"report.txt"}' } },
          ],
        }
        : { role: 'assistant', content: '企业模型已连接' }
      res.end(
        completionEvents(
          {
            choices: [{ message, finish_reason: request.tools?.length ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          },
          'm1',
          'completion-test',
        ),
      )
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试监听失败')
  const serverUrl = `http://127.0.0.1:${address.port}/api`
  const storage: ActivationStorage = {
    read: async () => ({ serverUrl, token: 'employee-private-token' }),
    write: async () => {},
    clear: async () => {},
  }
  const changed = vi.fn()
  const selected = vi.fn(async () => {})
  const adapter = new EnterpriseModels(
    { serverUrl, modelMaxRetries: 1, timeoutMs: 1000, contextWindow: 32768, maxTokens: 4096 },
    storage,
    changed,
    selected,
  )
  try {
    expect(adapter.providerRetryPolicy()).toMatchObject({ mode: 'normal', maxRetries: 1 })
    expect((await adapter.listModels('lfclaw')).map(model => ({ id: model.id, name: model.name }))).toEqual([
      { id: 'm1', name: '企业千问' },
    ])
    expect(selected).toHaveBeenCalledWith(['m1'], 'm1')
    expect(await adapter.resolveModel('lfclaw', 'm1')).toMatchObject({
      context: { contextWindow: 131072 },
      defaultMaxTokens: 32768,
    })
    maxTokens = 16384
    await adapter.refresh()
    expect(await adapter.resolveModel('lfclaw', 'm1')).toMatchObject({ defaultMaxTokens: 16384 })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'lfclaw',
      model: 'm1',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }))
      chunks.push(chunk)
    expect(JSON.stringify(chunks)).toContain('企业模型已连接')
    expect(JSON.stringify(chunks)).not.toContain('employee-private-token')
    expect(paths).toContain('/api/employee/v1/chat/completions')
    const toolChunks = []
    for await (const chunk of adapter.stream({
      provider: 'lfclaw',
      model: 'm1',
      messages: [],
      tools: [
        {
          name: 'read_document',
          description: '读取文档',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      ],
    }))
      toolChunks.push(chunk)
    expect(JSON.stringify(toolChunks)).toContain('read_document')
    expect(JSON.stringify(toolChunks)).toContain('tool-calls')
    contextWindow = 32768
    const oversized = {
      provider: 'lfclaw',
      model: 'm1',
      maxTokens: 8192,
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'x'.repeat(132000) }] }],
    }
    const countBefore = requests.length
    await expect(collect(adapter.stream(oversized))).rejects.toMatchObject({ code: 'CONTEXT_WINDOW_EXCEEDED' })
    expect(requests).toHaveLength(countBefore)
    contextWindow = 1000000
    const recovered = await collect(adapter.stream(oversized))
    expect(JSON.stringify(recovered)).toContain('企业模型已连接')
    expect(requests).toHaveLength(countBefore + 1)
    expect(requests.at(-1)?.max_completion_tokens).toBe(8192)
    expect(await adapter.resolveModel('lfclaw', 'm1')).toMatchObject({ context: { contextWindow: 1000000 } })
    contextWindow = 32768
    const largeTools = {
      provider: 'lfclaw',
      model: 'm1',
      maxTokens: 8192,
      messages: [],
      tools: [{ name: 'large_tool', description: 'x'.repeat(132000), parameters: { type: 'object' } }],
    }
    await expect(collect(adapter.stream(largeTools))).rejects.toMatchObject({ code: 'CONTEXT_WINDOW_EXCEEDED' })
    expect(requests).toHaveLength(countBefore + 1)
    maxTokens = 0
    await expect(adapter.refresh()).rejects.toThrow('企业模型容量无效')
    await expect(adapter.resolveModel('lfclaw', 'm1')).rejects.toThrow('此模型尚未授权')
    authorized = false
    expect(await adapter.listModels('lfclaw')).toEqual([])
    await expect(adapter.prepareCall('lfclaw', 'm1')).rejects.toThrow('此模型尚未授权')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve =>
      server.close(() => {
        resolve()
      }),
    )
  }
})

it('企业服务拒绝连接时给出可恢复的模型错误', async () => {
  const serverUrl = 'http://127.0.0.1:39811/lfclaw/api'
  const storage: ActivationStorage = {
    read: async () => ({ serverUrl, token: 'employee-private-token' }),
    write: async () => {},
    clear: async () => {},
  }
  const cause = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed', { cause }))
  const adapter = new EnterpriseModels(
    { serverUrl, modelMaxRetries: 1, timeoutMs: 1000, contextWindow: 32768, maxTokens: 4096 },
    storage,
    vi.fn(),
    async () => {},
    transport,
  )
  await expect(adapter.prepareCall('lfclaw', 'm1')).rejects.toMatchObject({
    code: 'TRANSPORT',
    message: '企业服务连接中断，请检查服务状态，并在工作区确认已生成的文件后重试',
  })
})
