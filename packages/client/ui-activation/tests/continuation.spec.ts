import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse, maxTokensResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { registerOutputContinuation } from '../src/continuation.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})
async function harness(script: ConstructorParameters<typeof MockAdapter>[0], maxAutoContinuations = 3, provider = 'lfclaw') {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter([provider], adapter)
  registerOutputContinuation(ctx, { provider: 'lfclaw', maxAutoContinuations, maxNoProgressContinuations: 2 })
  const agent = await ctx.agentLoop.create(SessionId('continuation-test'), { provider, model: 'mock' })
  async function send() {
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') {
          dispose()
          resolve()
        }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '完成任务' }], source: { kind: 'user' } }))
    await idle
  }
  return { ctx, agent, adapter, send }
}
function endings(agent: Awaited<ReturnType<typeof harness>>['agent']) {
  return agent.session
    .snapshotEvents()
    .filter(event => event.type === 'turn/end')
    .map(event => event.data.reason)
}
it('截断后自动续接且下一次请求保留已有输出和续接指令，人工消息重置预算', async () => {
  const { agent, adapter, send } = await harness(
    [maxTokensResponse('第一部分'), textResponse('剩余内容'), maxTokensResponse('新任务部分'), textResponse('新任务完成')],
    1,
  )
  await send()
  expect(adapter.requests).toHaveLength(2)
  expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('第一部分')
  expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('不重新执行已完成的工具操作')
  expect(endings(agent)).toEqual([{ kind: 'max-tokens' }, { kind: 'completed' }])
  const auto = agent.session
    .snapshotEvents()
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'lfclaw-output-continuation')
  expect(auto).toHaveLength(1)
  const output = agent.session
    .snapshotEvents()
    .map((event) => {
      if (event.type === 'user/message') return { type: event.type, source: event.data.source, content: event.data.content }
      if (event.type === 'assistant/message') return { type: event.type, content: event.data.message.content }
      if (event.type === 'turn/end') return { type: event.type, reason: event.data.reason }
      return undefined
    })
    .filter(event => event !== undefined)
  await expect(JSON.stringify(output, null, 2) + '\n').toMatchFileSnapshot('./expected/output-continuation.json')
  await send()
  expect(adapter.requests).toHaveLength(4)
})
it.each(['', '重复内容'])('连续无进展时停止并报告原因：%s', async (text) => {
  const { agent, adapter, send } = await harness(
    Array.from({ length: 3 }, () => maxTokensResponse(text)),
    8,
  )
  await send()
  expect(adapter.requests).toHaveLength(text ? 3 : 2)
  expect(endings(agent).at(-1)).toMatchObject({ kind: 'error', error: { code: 'OUTPUT_CONTINUATION_STALLED' } })
})
it('持续有新输出仍受续接次数限制', async () => {
  const { agent, adapter, send } = await harness([maxTokensResponse('a'), maxTokensResponse('b'), maxTokensResponse('c')], 2)
  await send()
  expect(adapter.requests).toHaveLength(3)
  expect(endings(agent).at(-1)).toMatchObject({ kind: 'error', error: { code: 'OUTPUT_CONTINUATION_LIMIT' } })
})
it('后续接口失败时停止，不把失败当作截断续接', async () => {
  const { agent, adapter, send } = await harness([
    maxTokensResponse('a'),
    () => {
      throw new LlmError('请求被拒绝', 'AUTH')
    },
  ])
  await send()
  expect(adapter.requests).toHaveLength(2)
  expect(endings(agent).at(-1)).toMatchObject({ kind: 'error', error: { code: 'AUTH' } })
})
it.each([0, 3])('正常完成不续接，零预算关闭恢复：%i', async (limit) => {
  const { adapter, send } = await harness([limit ? textResponse('done') : maxTokensResponse('a')], limit)
  await send()
  expect(adapter.requests).toHaveLength(1)
})
it('不接管其他提供商', async () => {
  const { adapter, send } = await harness([maxTokensResponse('a')], 3, 'other')
  await send()
  expect(adapter.requests).toHaveLength(1)
})
it('用户已有排队消息时优先处理用户，不额外追加续接', async () => {
  const { ctx, agent, adapter, send } = await harness([maxTokensResponse('a'), textResponse('done')])
  let queued = false
  ctx.on(
    'agent/turn-stopping',
    () => {
      if (queued) return
      queued = true
      agent.followup(createUserMessage({ content: [{ type: 'text', text: '改做新任务' }], source: { kind: 'user' } }))
    },
    true,
  )
  await send()
  expect(adapter.requests).toHaveLength(2)
  expect(
    agent.session
      .snapshotEvents()
      .filter(event => event.type === 'user/message' && event.data.source.kind === 'lfclaw-output-continuation'),
  ).toHaveLength(0)
})

it('用户取消后不再自动续接，下一条人工消息可开始新任务', async () => {
  const { ctx, agent, adapter, send } = await harness([maxTokensResponse('a'), 'hang', textResponse('new task')])
  const dispose = ctx.on('agent/assistant-stream', ({ frame }) => {
    if (adapter.requests.length === 2 && frame.type === 'chunk') agent.cancel({ kind: 'user' })
  })
  await send()
  dispose()
  expect(adapter.requests).toHaveLength(2)
  expect(endings(agent).at(-1)).toMatchObject({ kind: 'aborted' })
  expect(agent.inbox.nextTurn).toHaveLength(0)
  await send()
  expect(adapter.requests).toHaveLength(3)
})

it('恢复的续接提示保留已使用次数，不因恢复重置预算', async () => {
  const { agent, adapter } = await harness([maxTokensResponse('more')], 1)
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'continue' }],
      source: { kind: 'lfclaw-output-continuation', attempt: 1, form: 'notice', summary: 'continue' },
    }),
  )
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  expect(endings(agent).at(-1)).toMatchObject({ kind: 'error', error: { code: 'OUTPUT_CONTINUATION_LIMIT' } })
})
it('拒绝超出预算的排队续接，不消耗模型请求', async () => {
  const { agent, adapter } = await harness([], 1)
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'continue' }],
      source: { kind: 'lfclaw-output-continuation', attempt: 2 },
    }),
  )
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(0)
  expect(endings(agent).at(-1)).toMatchObject({ kind: 'error', error: { code: 'OUTPUT_CONTINUATION_LIMIT' } })
})
