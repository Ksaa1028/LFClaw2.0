// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExpertsPage } from '../src/client/ExpertsPage.tsx'
import { expertConversation } from '../src/client/expert-conversation.ts'
import { expertManagerDraft } from '../src/client/manager-draft.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const personal = {
  source: 'personal',
  id: 'p1',
  name: '营运分析师',
  description: '核对销售数据',
  instructions: '先核对来源',
  tags: ['营运'],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('shows three expert sections and edits a personal expert through a skill conversation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        experts: [
          { ...personal, id: 'e1', source: 'dsh' },
          { ...personal, id: 't1', name: '营运专家团', source: 'team', memberIds: ['e1', 'e2'] },
        ],
        personalExperts: [personal, { ...personal, id: 'pt1', name: '我的营运专家团', kind: 'team', memberIds: ['p1'] }],
        skills: [],
        connectors: [],
      }),
    ),
  )
  const manageExpert = vi.fn()
  render(<ExpertsPage t={t} notify={vi.fn()} startChat={vi.fn()} manageExpert={manageExpert} />)
  await screen.findByRole('tab', { name: '我的专家团' })
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['企业专家', '我的专家', '我的专家团'])
  expect(screen.getByText('营运分析师')).toBeTruthy()
  expect(screen.queryByText('营运专家团')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '我的专家团' }))
  expect(screen.getByText('我的营运专家团')).toBeTruthy()
  expect(screen.queryByText('营运专家团')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '我的专家' }))
  fireEvent.change(screen.getByRole('textbox', { name: zh.search }), { target: { value: '销售' } })
  fireEvent.click(screen.getByRole('button', { name: '查看 营运分析师 详情' }))
  fireEvent.click(screen.getByRole('button', { name: '对话修改' }))
  expect(manageExpert).toHaveBeenCalledWith('expert', { id: 'p1', name: '营运分析师' })
  expect(screen.queryByLabelText('名称')).toBeNull()
})
it('opens conversations directly for expert and team creation without showing configuration forms', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ experts: [], personalExperts: [], skills: [], connectors: [] })),
  )
  const manageExpert = vi.fn()
  render(<ExpertsPage t={t} notify={vi.fn()} startChat={vi.fn()} manageExpert={manageExpert} />)
  await screen.findByRole('tab', { name: '我的专家' })
  fireEvent.click(screen.getByRole('tab', { name: '我的专家' }))
  fireEvent.click(screen.getByRole('button', { name: '创建专家' }))
  expect(screen.queryByRole('button', { name: '创建专家团' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '我的专家团' }))
  fireEvent.click(screen.getByRole('button', { name: '创建专家团' }))
  expect(manageExpert.mock.calls).toEqual([['expert'], ['team']])
  expect(screen.queryByLabelText('名称')).toBeNull()
  expect(screen.queryByRole('button', { name: '生成草稿' })).toBeNull()
})
it('keeps expert details and the task visible when preparation fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ experts: [], personalExperts: [personal], skills: [], connectors: [] })),
  )
  const startChat = vi.fn().mockRejectedValue(new Error('所需技能已撤权'))
  render(<ExpertsPage t={t} notify={vi.fn()} startChat={startChat} manageExpert={vi.fn()} />)
  await screen.findByRole('tab', { name: '我的专家' })
  fireEvent.click(screen.getByRole('tab', { name: '我的专家' }))
  fireEvent.click(screen.getByRole('button', { name: '查看 营运分析师 详情' }))
  fireEvent.change(screen.getByLabelText('这次需要完成什么？'), { target: { value: '分析本月销售' } })
  fireEvent.click(screen.getByRole('button', { name: '准备对话' }))
  expect((await screen.findByRole('alert')).textContent).toContain('所需技能已撤权')
  expect(screen.getByLabelText<HTMLInputElement>('这次需要完成什么？').value).toBe('分析本月销售')
})
it('prepares instructions with exact skill references and requires real delegated team results', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ enterprise: [{ id: 's1', ready: true, invocationName: 'enterprise-analysis-a1b2c3' }] }),
    )
    .mockResolvedValueOnce(Response.json({ tools: [{ name: 'sales' }] }))
  const prompt = await expertConversation(
    {
      name: '营运专家团',
      instructions: '核对后汇总',
      members: [
        { name: '分析师', instructions: '核对收入' },
        { name: '复核员', instructions: '检查假设' },
      ],
      skills: [{ id: 's1', name: '经营分析' }],
      connectors: [{ id: 'c1', name: '商场数据' }],
    },
    '分析本月销售',
    t,
    transport,
  )
  expect(prompt).toMatchSnapshot()
  expect(prompt.text).toContain('调用 subagent 并等待系统回传真实结果')
  expect(prompt.text).toContain('审阅成员与方案成员并行委派')
  expect(prompt.text).toContain('普通排版、字数控制和最终汇总由主理人直接完成')
  expect(prompt.text).toContain('不反复调用 list_agents、运行 sleep 命令')
  expect(prompt.text).toContain('只在最终答复回传一次')
  expect(prompt.text).toContain('收到所有成员最终结果后只交付一次')
  expect(prompt.text).toContain('优先逐项满足用户明确要求的交付内容')
  expect(prompt.text).toContain('把目标控制在上限的八成以内')
  expect(prompt.text).toContain('禁止自己模拟成员发言')
  const ref = prompt.references[0]!
  expect(prompt.text.slice(ref.offset, ref.offset + ref.length)).toBe(ref.ref)
})
it('loads the built-in expert manager skill explicitly for all creation and editing drafts', () => {
  expect([
    expertManagerDraft('expert', t),
    expertManagerDraft('team', t),
    expertManagerDraft('expert', t, personal),
  ]).toMatchSnapshot()
  for (const kind of ['expert', 'team'] as const) {
    const draft = expertManagerDraft(kind, t)
    const ref = draft.references[0]!
    expect(draft.text.slice(ref.offset, ref.offset + ref.length)).toBe('/lfclaw-expert-manager')
    expect(ref.source).toBe('skill')
  }
})
it('stops before preparing a conversation if a local capability is unavailable', async () => {
  const expert = { name: '分析师', instructions: '分析', members: [], skills: [{ id: 's1', name: '经营分析' }], connectors: [] }
  await expect(
    expertConversation(expert, '分析', t, vi.fn().mockResolvedValue(Response.json({ enterprise: [{ id: 's1', ready: false }] }))),
  ).rejects.toThrow(zh.skillUnavailable)
  await expect(
    expertConversation(
      { ...expert, skills: [], connectors: [{ id: 'c1', name: '数据' }] },
      '分析',
      t,
      vi.fn().mockResolvedValue(Response.json({ tools: [] })),
    ),
  ).rejects.toThrow(zh.connectorUnavailable)
})

it.each(['expert', 'team'] as const)(
  'lets a saved personal %s start a task even when the response includes its personal source',
  async (kind) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ experts: [], personalExperts: [{ ...personal, kind }], skills: [], connectors: [] })),
    )
    const startChat = vi.fn().mockResolvedValue(undefined)
    render(<ExpertsPage t={t} notify={vi.fn()} startChat={startChat} manageExpert={vi.fn()} />)
    await screen.findByRole('tab', { name: '我的专家' })
    fireEvent.click(screen.getByRole('tab', { name: kind === 'team' ? '我的专家团' : '我的专家' }))
    fireEvent.click(screen.getByRole('button', { name: '查看 营运分析师 详情' }))
    expect(screen.queryByText(zh.remoteHint)).toBeNull()
    fireEvent.change(screen.getByLabelText(zh.task), { target: { value: '安排明日工作' } })
    fireEvent.click(screen.getByRole('button', { name: zh.start }))
    expect(startChat).toHaveBeenCalledWith('personal', 'p1', '安排明日工作')
  },
)

it.each(['bailian', 'dify', 'weknora'] as const)('offers a configured %s expert for a task', async (source) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(Response.json({ experts: [{ ...personal, source }], personalExperts: [], skills: [], connectors: [] })),
  )
  const startChat = vi.fn().mockResolvedValue(undefined)
  render(<ExpertsPage t={t} notify={vi.fn()} startChat={startChat} manageExpert={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看 营运分析师 详情' }))
  expect(
    screen.getAllByText(source === 'dify' ? zh.sourceDify : source === 'weknora' ? zh.sourceWeKnora : zh.sourceBailian).length,
  ).toBeGreaterThan(0)
  expect(screen.queryByText(zh.remoteHint)).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.task), { target: { value: '查询本月销售' } })
  fireEvent.click(screen.getByRole('button', { name: zh.start }))
  expect(startChat).toHaveBeenCalledWith('enterprise', 'p1', '查询本月销售')
})
it('prepares a remote expert task that requires a real service call', async () => {
  const prompt = await expertConversation(
    {
      name: '数据查询',
      instructions: '',
      members: [],
      skills: [],
      connectors: [],
      remote: { id: 'remote-1', source: 'bailian' },
    },
    '查询本月销售',
    t,
    vi.fn().mockResolvedValue(Response.json({ remoteExpert: true })),
  )
  expect(prompt).toMatchSnapshot()
  expect(prompt.text).toContain('call_enterprise_expert')
  expect(prompt.text).toContain('remote-1')
  expect(prompt.text).toContain('查询本月销售')
  expect(prompt.references).toEqual([])
  await expect(
    expertConversation(
      {
        name: '数据查询',
        instructions: '',
        members: [],
        skills: [],
        connectors: [],
        remote: { id: 'remote-1', source: 'bailian' },
      },
      '查询本月销售',
      t,
      vi.fn().mockResolvedValue(Response.json({ message: 'Missing' }, { status: 404 })),
    ),
  ).rejects.toThrow(zh.remoteToolUnavailable)
})
it('keeps unsupported external platforms out of task preparation', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ experts: [{ ...personal, source: 'external' }], personalExperts: [], skills: [], connectors: [] }),
      ),
  )
  render(<ExpertsPage t={t} notify={vi.fn()} startChat={vi.fn()} manageExpert={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看 营运分析师 详情' }))
  expect(screen.getByText(zh.remoteHint)).toBeTruthy()
  expect(screen.queryByRole('button', { name: zh.start })).toBeNull()
})
