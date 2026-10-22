import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelResponseDeadline, validGatewayMessages, gatewayOptions, completionEvents, forwardCompletionStream } from '../src/model-gateway.ts'
test('企业网关保留完整工具对话并拒绝无关联的工具结果', () => {
  assert(validGatewayMessages([{ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_document', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: '文档内容' }]))
  assert(!validGatewayMessages([{ role: 'tool', content: '没有工具调用ID' }]))
  assert(!validGatewayMessages([{ role: 'unknown', content: '不支持的角色' }]))
  const options = gatewayOptions({ tools: [{ type: 'function' }], model: 'attacker-model', apiKey: 'attacker-key', baseURL: 'https://attacker.example' })
  assert.deepEqual(options, { tools: [{ type: 'function' }] })
  const stream = completionEvents({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_document', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }, 'm1', 'request1')
  assert.match(stream, /"index":0/)
  assert.match(stream, /read_document/)
  assert.match(stream, /data: \[DONE\]/)
})

test('上游输出尚未结束就能收到文本，保留分片工具参数和最终用量', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  const encoder = new TextEncoder()
  const output: string[] = []
  let activityCount = 0
  let first!: () => void
  const received = new Promise<void>(resolve => { first = resolve })
  const completion = forwardCompletionStream(new Response(body), async event => { output.push(event); first() }, () => { activityCount++ })
  controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"正在生成"}}]}\r\n\r\n'))
  await received
  assert.match(output[0]!, /正在生成/)
  controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\\"name\\\":"}}]}}]}\n\n'))
  controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\ndata: [DONE]\n\n'))
  controller.close()
  assert.deepEqual(await completion, { usage: { prompt_tokens: 10, completion_tokens: 20 } })
  assert.equal(activityCount, 3)
  assert.match(output.join(''), /tool_calls/)
  assert(!output.join('').includes('[DONE]'))
})

test('断流、上游流错误和非法事件不会被标记为完成', async () => {
  for (const data of ['data: {"choices":[]}\n\n', 'data: {"error":{"message":"failed"}}\n\n', 'data: invalid-json\n\n']) {
    await assert.rejects(forwardCompletionStream(new Response(data), async () => {}))
  }
})

test('流式模型活动延长等待，静默超时与取消仍然生效，结束后清理计时器', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const parent = new AbortController(), deadline = modelResponseDeadline(120, parent.signal)
  context.mock.timers.tick(100)
  assert.equal(deadline.signal.aborted, false)
  deadline.activity()
  context.mock.timers.tick(100)
  assert.equal(deadline.signal.aborted, false)
  context.mock.timers.tick(21)
  assert.equal(deadline.signal.aborted, true)
  assert.equal(deadline.signal.reason.name, 'TimeoutError')
  deadline.dispose()
  const cancelled = modelResponseDeadline(120, parent.signal)
  parent.abort()
  assert.equal(cancelled.signal.aborted, true)
  cancelled.dispose()
  const completed = modelResponseDeadline(120)
  completed.dispose()
  context.mock.timers.tick(121)
  assert.equal(completed.signal.aborted, false)
})
