import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { modelCapacity, modelThinkingOption, validModelCapacity, validModelThinkingOption } from '../src/model-capacity.ts'

test('模型容量输出保留旧记录并采用管理员声明的值', () => {
  const actual = { legacy: modelCapacity({}), configured: modelCapacity({ contextWindow: 131072, maxTokens: 32768 }) }
  assert.deepEqual(actual, JSON.parse(readFileSync(new URL('./expected/model-capacity.json', import.meta.url), 'utf8')))
  for (const invalid of [null, '8192', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validModelCapacity({ maxTokens: invalid }), false)
    assert.equal(validModelCapacity({ contextWindow: invalid }), false)
  }
  assert.equal(validModelCapacity({ contextWindow: 1024, maxTokens: 2048 }), false)
})

test('模型思考开关只转发明确配置的布尔值', () => {
  assert.deepEqual(modelThinkingOption({}), {})
  assert.deepEqual(modelThinkingOption({ enableThinking: null }), {})
  assert.deepEqual(modelThinkingOption({ enableThinking: false }), { enable_thinking: false })
  assert.deepEqual(modelThinkingOption({ enableThinking: true }), { enable_thinking: true })
  for (const invalid of ['false', 0, {}, []]) assert.equal(validModelThinkingOption({ enableThinking: invalid }), false)
})
