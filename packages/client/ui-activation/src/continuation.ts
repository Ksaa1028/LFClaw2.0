/** 企业模型的有限自动续接；不重试接口错误，不重放工具调用。 */
export type {} from './continuation-types.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'

/** 每个人工请求允许的续接次数和连续无进展次数。 */
export interface ContinuationConfig {
  /** 允许自动续接的提供商路由。 */
  provider: string
  /** 每个人工请求的最多续接次数，0 关闭续接。 */
  maxAutoContinuations: number
  /** 连续空文本或相同文本且无成功工具结果的停止次数。 */
  maxNoProgressContinuations: number
}
interface State {
  attempts: number
  stalled: number
  previous: string
  output: string
  toolProgress: boolean
  truncated: boolean
}
function fresh(): State {
  return { attempts: 0, stalled: 0, previous: '', output: '', toolProgress: false, truncated: false }
}

/** 注册企业路由的自动续接，停止和失败由已有轮次错误界面报告。
 * @param ctx 插件上下文，卸载时释放监听。
 * @param config 每个人工请求的有限恢复预算，零次数关闭续接。
 */
export function registerOutputContinuation(ctx: Context, config: ContinuationConfig): void {
  const states = new WeakMap<Agent, State>()
  const removePending = (agent: Agent): void => {
    for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
      if (message.source.kind === 'lfclaw-output-continuation') agent.inbox.remove(message.id)
    }
  }
  ctx.effect(() => () => { for (const agent of ctx.agents.list()) removePending(agent) }, 'lfclaw: cancel queued output continuations')
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind === 'user') removePending(agent)
  })
  ctx.on('agent/pre-step', ({ messages }, next) => {
    for (const message of messages) {
      if (message.source.kind !== 'lfclaw-output-continuation') continue
      if (!Number.isSafeInteger(message.source.attempt) || message.source.attempt < 1
        || message.source.attempt > config.maxAutoContinuations) {
        throw new LlmError('自动续接记录超出允许范围，已停止。请重新发送任务以继续。', 'OUTPUT_CONTINUATION_LIMIT')
      }
    }
    return next()
  })
  ctx.on('session/event', (session, event) => {
    const agent = ctx.agents.get(session.id)
    if (!agent || agent.session !== session) return
    let state = states.get(agent)
    if (!state) { state = fresh(); states.set(agent, state) }
    switch (event.type) {
      case 'turn/start':
        state.output = ''; state.toolProgress = false; state.truncated = false
        return
      case 'user/message':
        if (event.data.source.kind === 'lfclaw-output-continuation') {
          state.attempts = Math.max(state.attempts, event.data.source.attempt)
        } else if (event.data.source.kind === 'user') {
          states.set(agent, fresh())
        }
        return
      case 'assistant/message': {
        state.output += event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
        const last = event.data.stream.at(-1)
        const finish = last?.type === 'chunk' ? last.chunk : undefined
        state.truncated = finish?.type === 'finish' && finish.reason.kind === 'max-tokens'
        return
      }
      case 'tool/result':
        if (!event.data.message.isError) state.toolProgress = true
        return
      case 'turn/end':
        if (event.data.reason.kind !== 'max-tokens') { states.delete(agent); removePending(agent) }
        return
      default:
        // Other merge-extensible session events do not affect continuation progress.
        return
    }
  })
  ctx.on('agent/turn-stopping', ({ agent, signal }) => {
    const state = states.get(agent)
    if (!state || signal.aborted || config.maxAutoContinuations === 0
      || agent.session.requestHeader()?.config.provider !== config.provider || !state.truncated) return
    if (agent.inbox.nextTurn.length || agent.inbox.nextStep.length) { states.delete(agent); return }
    const output = state.output.trim()
    const progressed = state.toolProgress || (output.length > 0 && output !== state.previous)
    state.stalled = progressed ? 0 : state.stalled + 1
    state.previous = output
    if (state.stalled >= config.maxNoProgressContinuations) {
      throw new LlmError('模型连续返回空内容或重复内容，自动续接已停止。已有输出已保留，请调整模型设置或换用模型后重试。', 'OUTPUT_CONTINUATION_STALLED')
    }
    if (state.attempts >= config.maxAutoContinuations) {
      throw new LlmError('已达到本次任务的自动续接次数上限，已有输出已保留。请缩小任务范围，或检查模型输出上限后继续。', 'OUTPUT_CONTINUATION_LIMIT')
    }
    state.attempts += 1
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '上一条模型输出因单次输出 token 上限被截断。请从中断处继续完成用户当前任务，保留已完成的工作，不重复已有内容，不重新执行已完成的工具操作；若任务已经完成，直接简洁说明结果。' }],
      source: { kind: 'lfclaw-output-continuation', attempt: state.attempts, form: 'notice', summary: '输出达到上限，正在自动继续' },
    }))
  })
}
