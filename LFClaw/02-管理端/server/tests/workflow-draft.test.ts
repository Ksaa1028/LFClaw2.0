/** AI 草稿不接受任意人员标识或无时区的日期。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseWorkflowDraft } from '../src/workflow-draft.ts'
const draft = { reply: '请补充时间', title: '海报制作', summary: 'A3 海报', requirement: '交付印刷稿', assignee: 'worker', reviewer: 'me', deadline: '', cc: ['me', 'me'] }
test('模型草稿校验人员、必填字段和日期，并允许缺项追问', () => {
  const people = new Set(['me', 'worker'])
  assert.deepEqual(parseWorkflowDraft(JSON.stringify(draft), people).cc, ['me'])
  assert.equal(parseWorkflowDraft('```json\n' + JSON.stringify(draft) + '\n```', people).title, '海报制作')
  for (const change of [{ assignee: 'outsider' }, { cc: ['outsider'] }, { title: null }, { deadline: '2030-10-25T17:00' }, { reply: '' }])
    assert.throws(() => parseWorkflowDraft(JSON.stringify({ ...draft, ...change }), people), /AI/)
  assert.throws(() => parseWorkflowDraft('not json', people), /AI/)
  assert.equal(parseWorkflowDraft(JSON.stringify({ ...draft, deadline: '2030-10-25T17:00:00+08:00' }), people).deadline, '2030-10-25T17:00:00+08:00')
})
