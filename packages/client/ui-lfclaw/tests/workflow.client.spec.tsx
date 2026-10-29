// @vitest-environment jsdom
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Workflows } from '../src/client/Workflows.tsx'
import type {} from '../src/client/workflow-registration.tsx'
import { workflowZh } from '../src/client/workflow-locales.ts'
const t = makeTranslate(workflowZh)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const employees = [{ id: 'me', name: '营运张三', department: '营运部' }, { id: 'worker', name: '设计李四', department: '营销部' }]
const work = { id: 'w', title: '会员海报', creator: 'me', assignee: 'worker', reviewer: 'me', status: 'processing', revision: 1,
  deadline: '2030-10-25T09:00:00Z', requirement: '交付 A3 印刷文件', resultOnly: false,
  history: [{ actor: 'me', action: 'create', time: '2026-10-23T09:00:00Z', original: '原始业务说明', summary: '已确认 A3', artifacts: [] }] }
it('shows participating workflows and preserves original notes beside the summary', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ maxRequestBytes: 4194304, employeeId: 'me', employees, items: [work] })))
  const { container } = render(<Workflows t={t} refreshIntervalMs={60000} notify={vi.fn()} />)
  await screen.findByText('我参与的'); fireEvent.click(screen.getByRole('button', { name: '我参与的' }))
  fireEvent.click(screen.getByRole('button', { name: /会员海报/ }))
  expect(screen.getByText('原始业务说明')).toBeTruthy(); expect(screen.getByText('已确认 A3')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '提交验收' })).toBeNull()
  expect(Array.from(container.querySelectorAll('button')).map(b => b.textContent)).toMatchSnapshot()
})
it('creates a confirmed workflow and retains the draft after a failed save', async () => {
  const notify = vi.fn(), writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { if (typeof init.body !== 'string') throw new Error('Expected JSON body'); writes.push(JSON.parse(init.body) as Record<string, unknown>); return Response.json({}, { status: 502 }) }
    return Response.json({ maxRequestBytes: 4194304, employeeId: 'me', employees, items: [] })
  }))
  render(<Workflows t={t} refreshIntervalMs={60000} notify={notify} />)
  fireEvent.click(await screen.findByRole('button', { name: '发起工作' }))
  fireEvent.change(screen.getByLabelText(workflowZh.summary), { target: { value: '手工确认需求摘要' } })
  fireEvent.change(screen.getByLabelText('工作标题'), { target: { value: '海报设计' } })
  fireEvent.change(screen.getByLabelText('原始内容 / 处理说明'), { target: { value: '活动海报原始说明' } })
  fireEvent.change(screen.getByLabelText('确认后的需求、交付物与验收标准'), { target: { value: '交付 A3 文件' } })
  fireEvent.change(screen.getByLabelText('处理人'), { target: { value: 'worker' } })
  fireEvent.change(screen.getByLabelText('截止时间'), { target: { value: '2030-10-25T17:00' } })
  fireEvent.click(screen.getByRole('button', { name: '确认需求并指派' }))
  await waitFor(() =>{  expect(notify).toHaveBeenCalledWith(workflowZh.failed) })
  expect(writes[0]).toMatchObject({ action: 'create', original: '活动海报原始说明', requirement: '交付 A3 文件', assignee: 'worker', reviewer: 'me' })
  expect(screen.getByDisplayValue('活动海报原始说明')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '确认需求并指派' }))
  await waitFor(() =>{  expect(writes).toHaveLength(2) })
  expect(writes[1]?.operationId).toBe(writes[0]?.operationId)
})
it('completion copies expose only supplied final results and no handling controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ maxRequestBytes: 4194304, employeeId: 'copy', employees, items: [{ ...work, status: 'completed', resultOnly: true,
    requirement: undefined, history: [{ ...work.history[0], original: '最终文字产物', summary: '验收通过', artifacts: [] }] }] })))
  const { container } = render(<Workflows t={t} refreshIntervalMs={60000} notify={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '抄送我的' }))
  fireEvent.click(screen.getByRole('button', { name: /会员海报/ }))
  expect(screen.getByText(workflowZh.resultOnly)).toBeTruthy()
  expect(container.querySelector('fieldset')).toBeNull()
  expect(Array.from(container.querySelectorAll('button')).map(b => b.textContent)).toMatchSnapshot()
})

it('uses conversation to fill a draft, filters copies, preserves edits on return and navigates after creation', async () => {
  const writes: Record<string, unknown>[] = [], notify = vi.fn()
  let created = false, drafts = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('workflow-summary')) {
      drafts++
      return Response.json({ reply: drafts === 1 ? '已整理，请补充截止时间' : '已补齐时间，请核对后发起', title: '会员海报制作',
        summary: '制作 A3 海报', requirement: '交付 A3 印刷文件', assignee: 'worker', reviewer: 'me',
        deadline: drafts === 1 ? '' : '2030-10-25T09:00:00Z', cc: [] })
    }
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Expected JSON body')
      writes.push(JSON.parse(init.body) as Record<string, unknown>); created = true
      return Response.json(work)
    }
    return Response.json({ maxRequestBytes: 4194304, employeeId: 'me', employees, items: created ? [work] : [] })
  }))
  render(<Workflows t={t} refreshIntervalMs={60000} notify={notify} />)
  fireEvent.click(await screen.findByRole('button', { name: workflowZh.create }))
  fireEvent.change(screen.getByLabelText(workflowZh.message), { target: { value: '让李四做会员 A3 海报' } })
  fireEvent.click(screen.getByRole('button', { name: workflowZh.send }))
  await screen.findByText('已整理，请补充截止时间')
  expect(screen.getByDisplayValue('会员海报制作')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(workflowZh.message), { target: { value: '2030 年 10 月 25 日下午五点交付' } })
  fireEvent.click(screen.getByRole('button', { name: workflowZh.send }))
  await screen.findByText('已补齐时间，请核对后发起')
  fireEvent.click(screen.getByRole('button', { name: workflowZh.editFields }))
  fireEvent.change(screen.getByLabelText(workflowZh.searchPeople), { target: { value: '李四' } })
  expect(screen.queryByRole('checkbox', { name: /张三/ })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: /李四/ }))
  fireEvent.change(screen.getByLabelText(workflowZh.searchPeople), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(workflowZh.department), { target: { value: '营运部' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /张三/ }))
  expect(screen.getByRole('button', { name: /移除 设计李四/ })).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: workflowZh.back })[0]!)
  fireEvent.click(screen.getByRole('button', { name: workflowZh.resume }))
  expect(screen.getByDisplayValue('会员海报制作')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: workflowZh.confirm }))
  await waitFor(() => { expect(notify).toHaveBeenCalledWith(workflowZh.created) })
  expect(writes[0]).toMatchObject({ title: '会员海报制作', cc: ['worker', 'me'], assignee: 'worker' })
  expect(writes[0]?.original).toContain('2030 年 10 月 25 日下午五点交付')
  expect(screen.getByRole('button', { name: workflowZh.mine }).getAttribute('aria-pressed')).toBe('true')
  expect(await screen.findByRole('button', { name: /会员海报/ })).toBeTruthy()
})

it('keeps an unsent message and manual fields when AI fails', async () => {
  const notify = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('workflow-summary') ? Response.json({}, { status: 502 })
    : Response.json({ maxRequestBytes: 4194304, employeeId: 'me', employees, items: [] })))
  render(<Workflows t={t} refreshIntervalMs={60000} notify={notify} />)
  fireEvent.click(await screen.findByRole('button', { name: workflowZh.create }))
  fireEvent.change(screen.getByLabelText(workflowZh.message), { target: { value: '需要一张海报' } })
  fireEvent.click(screen.getByRole('button', { name: workflowZh.send }))
  await waitFor(() => { expect(notify).toHaveBeenCalledWith(workflowZh.summaryFailed) })
  expect(screen.getByDisplayValue('需要一张海报')).toBeTruthy()
  expect(screen.getByRole('button', { name: workflowZh.confirm }).hasAttribute('disabled')).toBe(true)
})

it('generates a missing handoff summary before submitting handling notes', async () => {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Expected JSON body')
      requests.push(JSON.parse(init.body) as Record<string, unknown>)
      return Response.json(url.endsWith('workflow-summary') ? { summary: 'A3 印刷稿已制作完成，待验收' } : { ...work, revision: 2, status: 'review' })
    }
    return Response.json({ maxRequestBytes: 4194304, employeeId: 'worker', employees, items: [work] })
  }))
  render(<Workflows t={t} refreshIntervalMs={60000} notify={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /会员海报/ }))
  fireEvent.change(screen.getByLabelText(workflowZh.original), { target: { value: 'A3 印刷稿已做好，请验收' } })
  fireEvent.click(screen.getByRole('button', { name: workflowZh.submit }))
  await waitFor(() => { expect(requests).toHaveLength(2) })
  expect(requests[1]).toMatchObject({ action: 'submit', original: 'A3 印刷稿已做好，请验收', summary: 'A3 印刷稿已制作完成，待验收' })
})
