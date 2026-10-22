/** 企业网关的 OpenAI 消息校验与完整响应到 SSE 的投影。 */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
/** 校验文本和工具消息，拒绝未知消息角色与不完整工具关联。 */
export function validGatewayMessages(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 1000 && value.every(value => {
    const message = object(value)
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(String(message.role))) return false
    const content = message.content
    const validContent = typeof content === 'string' || (Array.isArray(content) && content.every(part => {
      const item = object(part); return item?.type === 'text' && typeof item.text === 'string'
    }))
    if (message.role === 'tool' && typeof message.tool_call_id !== 'string') return false
    if (message.tool_calls !== undefined) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || !message.tool_calls.every(value => {
        const call = object(value); const fn = object(call?.function)
        return typeof call?.id === 'string' && call.type === 'function' && typeof fn?.name === 'string' && typeof fn.arguments === 'string'
      })) return false
    }
    return validContent || (message.role === 'assistant' && content === null && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
  })
}
/** 保留工具参数和受支持生成选项；model、凭据和 endpoint 始终由服务端决定。 */
export function gatewayOptions(body: Record<string, unknown>): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const key of ['tools', 'tool_choice', 'parallel_tool_calls', 'temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'stop', 'response_format']) {
    if (body[key] !== undefined) options[key] = body[key]
  }
  return options
}
/** 将有界的完整上游响应编码为 OpenAI SSE，支持文本、工具调用及用量。 */
export function completionEvents(value: unknown, model: string, id: string): string {
  const body = object(value)
  if (!Array.isArray(body?.choices) || body.choices.length === 0) throw new Error('模型服务未返回有效的回答')
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model }
  const choices = body.choices.map((value, index) => {
    const choice = object(value); const message = object(choice?.message)
    if (!message) throw new Error('模型回答格式无效')
    const tools = Array.isArray(message.tool_calls) ? message.tool_calls.map((value, index) => ({ ...object(value), index })) : undefined
    return { index, delta: { ...message, ...(tools ? { tool_calls: tools } : {}) }, finish_reason: null }
  })
  const ends = body.choices.map((value, index) => ({ index, delta: {}, finish_reason: object(value)?.finish_reason ?? 'stop' }))
  return `data: ${JSON.stringify({ ...base, choices })}\n\ndata: ${JSON.stringify({ ...base, choices: ends })}\n\ndata: ${JSON.stringify({ ...base, choices: [], usage: body.usage })}\n\ndata: [DONE]\n\n`
}

/** 实时转发上游 SSE，收集最终用量；缺少结束标记时不报告完成。 */
export async function forwardCompletionStream(response: globalThis.Response, write: (event: string) => Promise<void>, activity?: () => void): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('模型流没有响应正文')
  const decoder = new TextDecoder()
  let buffer = '', total = 0, completed = false
  let usage: unknown
  async function frame(text: string): Promise<void> {
    const data = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    if (completed) throw new Error('模型流在结束后返回额外内容')
    if (data === '[DONE]') { completed = true; return }
    const value = object(JSON.parse(data))
    if (!value || value.error || !Array.isArray(value.choices)) throw new Error('模型流返回错误或格式无效')
    if (value.usage) usage = value.usage
    await write(`data: ${JSON.stringify(value)}\n\n`)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      activity?.()
      total += value.byteLength
      if (total > 2 * 1024 * 1024) throw new Error('模型响应超出限制')
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const text = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        await frame(text)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) await frame(buffer)
    if (!completed) throw new Error('模型流意外中断，请重试')
    return { usage }
  } finally { await reader.cancel().catch(() => { /* 请求失败时仍释放读取器。 */ }); reader.releaseLock() }
}

/** 模型请求的无响应计时器；流式调用收到数据后重新计时。
 * @param timeoutMs - 首次响应及相邻数据块之间允许的最长等待。
 * @param parent - 客户端取消信号。
 * @returns 取消信号、活动通知和清理函数。
 */
export function modelResponseDeadline(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; activity: () => void; dispose: () => void } {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const activity = () => {
    clearTimeout(timer)
    if (!controller.signal.aborted) timer = setTimeout(() => controller.abort(new DOMException('模型响应超时，请稍后重试', 'TimeoutError')), timeoutMs)
  }
  activity()
  return { signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    activity, dispose: () => clearTimeout(timer) }
}
