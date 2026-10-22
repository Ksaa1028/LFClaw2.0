import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { expertManagerInstructions } from '../src/expert-manager-skill.ts'
import { EXPERT_MANAGER_SKILL } from '../src/manager-name.ts'

it('registers the invocable expert management skill and saves through authenticated Host tools', async () => {
  const ctx = new Context()
  new SkillRegistry(ctx)
  const register = vi.fn().mockReturnValue(() => {})
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === 'employee/me')
      return Response.json({
        personalExperts: [{ id: 'p1', name: '分析师' }],
        skills: [{ id: 's1', name: '经营分析' }],
        connectors: [],
      })
    if (init?.method === 'PUT') return Response.json({ id: 'p1', name: '新名称', kind: 'expert' })
    if (init?.method === 'POST') return Response.json({ id: 'new-id', name: '分析师', kind: 'expert' })
    return Response.json({
      id: 'p1',
      name: '分析师',
      description: '分析',
      instructions: '先核对',
      tags: [],
      revision: 'a'.repeat(64),
    })
  })
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    connection: { value: { fetch: { register: vi.fn().mockReturnValue(() => {}) } } },
    tools: { value: { register } },
  })
  apply(ctx)
  try {
    const skill = await ctx.skills.get(EXPERT_MANAGER_SKILL)
    expect(skill?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(skill?.content).toBe(expertManagerInstructions)
    expect(expertManagerInstructions).toMatchSnapshot()
    const catalog = await register.mock.calls[0]![0].execute({}, { signal: new AbortController().signal })
    expect(catalog).toEqual({
      personalExperts: [{ id: 'p1', name: '分析师', kind: 'expert' }],
      skills: [{ id: 's1', name: '经营分析' }],
      connectors: [],
    })
    const read = await register.mock.calls[1]![0].execute({ id: 'p1' }, { signal: new AbortController().signal })
    expect(read).toMatchObject({ revision: 'a'.repeat(64), kind: 'expert', connectorIds: [] })
    const definition = {
      name: '分析师',
      description: '分析',
      instructions: '先核对',
      kind: 'expert',
      tags: [],
      memberIds: [],
      skillIds: [],
      connectorIds: [],
      quickPrompts: [],
    }
    const save = register.mock.calls[2]![0]
    const signal = new AbortController().signal
    expect(await save.execute(definition, { signal })).toEqual({ id: 'new-id', name: '分析师', kind: 'expert' })
    expect(request).toHaveBeenCalledWith('employee/personal-experts', expect.objectContaining({ signal, method: 'POST' }))
    await expect(save.execute({ ...definition, id: 'p1' }, { signal })).rejects.toThrow('修订摘要')
    expect(await save.execute({ ...definition, id: 'p1', revision: read.revision }, { signal })).toMatchObject({
      id: 'p1',
      name: '新名称',
    })
    expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string)).toMatchObject({ expectedRevision: read.revision })
  } finally {
    await ctx.fiber.dispose()
  }
})
it('does not report success or blindly retry a save with an unknown outcome', async () => {
  const ctx = new Context()
  const register = vi.fn().mockReturnValue(() => {})
  const request = vi.fn().mockRejectedValue(new Error('connection lost'))
  Object.defineProperties(ctx, {
    skills: { value: { register: vi.fn().mockReturnValue(() => {}) } },
    enterpriseConnection: { value: { request } },
    connection: { value: { fetch: { register: vi.fn().mockReturnValue(() => {}) } } },
    tools: { value: { register } },
  })
  apply(ctx)
  try {
    await expect(
      register.mock.calls[2]![0].execute(
        {
          name: '分析师',
          description: '',
          instructions: '核对',
          kind: 'expert',
          tags: [],
          memberIds: [],
          skillIds: [],
          connectorIds: [],
          quickPrompts: [],
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('无法确认专家保存结果')
    expect(request).toHaveBeenCalledTimes(1)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('creates new team members and reused references with one authenticated save', async () => {
  const ctx = new Context()
  const register = vi.fn().mockReturnValue(() => {})
  const request = vi
    .fn()
    .mockResolvedValue(Response.json({ team: { id: 'team-id', name: '营运专家团' }, members: [{ id: 'new-id' }] }))
  Object.defineProperties(ctx, {
    skills: { value: { register: vi.fn().mockReturnValue(() => {}) } },
    enterpriseConnection: { value: { request } },
    connection: { value: { fetch: { register: vi.fn().mockReturnValue(() => {}) } } },
    tools: { value: { register } },
  })
  apply(ctx)
  try {
    const tool = register.mock.calls.find(call => call[0].name === 'create_personal_expert_team')![0]
    const definition = {
      name: '新成员',
      description: '',
      instructions: '核对',
      kind: 'expert',
      tags: [],
      memberIds: [],
      skillIds: [],
      connectorIds: [],
      quickPrompts: [],
    }
    const args = {
      team: { ...definition, name: '营运专家团', kind: 'team', memberIds: ['existing-id', 'new:review'] },
      newMembers: [{ key: 'review', definition }],
    }
    const signal = new AbortController().signal
    expect(await tool.execute(args, { signal })).toEqual({ id: 'team-id', name: '营运专家团', createdMembers: 1 })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      'employee/personal-expert-teams',
      expect.objectContaining({ signal, method: 'POST', body: JSON.stringify(args) }),
    )
  } finally {
    await ctx.fiber.dispose()
  }
})

it('mounts a remote expert tool and readiness route, forwarding only the selected task', async () => {
  const ctx = new Context()
  const register = vi.fn().mockReturnValue(() => {})
  const registerRoute = vi.fn().mockReturnValue(() => {})
  const request = vi.fn().mockResolvedValue(Response.json({ text: '实际远程答复', sessionId: 'session-1' }))
  Object.defineProperties(ctx, {
    skills: { value: { register: vi.fn().mockReturnValue(() => {}) } },
    enterpriseConnection: { value: { request } },
    connection: { value: { fetch: { register: registerRoute } } },
    tools: { value: { register } },
  })
  apply(ctx)
  try {
    const tool = register.mock.calls.find(call => call[0].name === 'call_enterprise_expert')![0]
    const signal = new AbortController().signal
    expect(await tool.execute({ id: 'x-1', prompt: '查询销售' }, { signal })).toEqual({
      text: '实际远程答复',
      sessionId: 'session-1',
    })
    expect(request).toHaveBeenCalledWith(
      'employee/experts/x-1/chat',
      expect.objectContaining({ method: 'POST', signal, body: JSON.stringify({ prompt: '查询销售' }) }),
    )
    const route = registerRoute.mock.calls.find(call => call[0].path === '/api/lfclaw/expert-runtime')![0]
    expect(await route.fetch()).toMatchObject({ status: 200 })
    expect(await (await route.fetch()).json()).toEqual({ remoteExpert: true })
  } finally {
    await ctx.fiber.dispose()
  }
})
