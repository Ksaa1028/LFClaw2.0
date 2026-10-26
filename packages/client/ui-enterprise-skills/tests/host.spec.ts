import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { apply } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
it('技能选择器读取轻量目录，不等待完整展示目录或后台个人清单上报', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'lfclaw-picker-skills-'))
  roots.push(dataDirectory)
  const ctx = new Context()
  const report = Promise.withResolvers<Response>()
  const display = Promise.withResolvers<Response>()
  const archive = zipSync({ 'SKILL.md': strToU8('---\nname: reports\ndescription: 日报\n---\n整理日报\n') })
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const request = vi.fn(async (path: string) => {
    if (path === 'employee/me') return display.promise
    if (path.endsWith('/report')) return report.promise
    if (path.endsWith('/download')) return new Response(archive)
    return Response.json({
      employee: { id: 'a' },
      skills: [{ id: 's1', name: '日报', description: '日报', version: '1', sha256 }],
    })
  })
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  Object.defineProperties(ctx, {
    enterpriseConnection: { value: { request } },
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route)
            return () => {}
          },
        },
      },
    },
    tools: { value: { register: () => () => {} } },
    skills: {
      value: {
        registerProvider: (factory: (control: SkillProviderControl) => SkillProvider) => {
          factory({ signal: new AbortController().signal, invalidate: () => {} })
          return () => {}
        },
      },
    },
  })
  apply(ctx, { dataDirectory, refreshIntervalMs: 30000, maxArchiveBytes: 10000, maxUnpackedBytes: 20000, maxFiles: 20 })
  try {
    await vi.waitFor(() => {
      expect(request.mock.calls.some(([path]) => path.endsWith('/report'))).toBe(true)
    })
    let body: unknown
    const pending = routes
      .get('/api/lfclaw/skill-center')!
      .fetch(new Request('http://localhost/api/lfclaw/skill-center?wait=1'))
      .then(async (response) => {
        body = await response.json()
      })
    await vi.waitFor(() => {
      expect(body).toMatchObject({ enterprise: [{ ready: true, invocationName: expect.any(String) }] })
    })
    await pending
    expect(request.mock.calls.some(([path]) => path === 'employee/skill-catalog')).toBe(true)
    expect(request.mock.calls.some(([path]) => path === 'employee/me')).toBe(false)
    const fresh = await routes.get('/api/lfclaw/skill-center')!.fetch(
      new Request('http://localhost/api/lfclaw/skill-center?wait=1&refresh=1'),
    )
    expect(fresh.status).toBe(200)
    expect(request.mock.calls.some(([path]) => path === 'employee/me')).toBe(false)
  } finally {
    display.resolve(Response.json({ employee: { id: 'a' }, skills: [] }))
    report.resolve(Response.json({ ok: true }))
    await ctx.fiber.dispose()
  }
})

it('本机接口使用 Host 员工身份；对话保存后可由标准技能接口加载并隔离账号', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'lfclaw-host-skills-'))
  roots.push(dataDirectory)
  const ctx = new Context()
  let employee = 'employee-a'
  let enterpriseAllowed = true
  const catalogPaths: string[] = []
  const archive = zipSync({
    'SKILL.md': strToU8('---\nname: enterprise-reports\ndescription: 企业简介\n---\n使用企业日报流程\n'),
  })
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const providers = new Map<string, SkillProvider>()
  let provider: SkillProvider | undefined
  const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
  const tools = vi.fn()
  const invalidate = vi.fn()
  Object.defineProperties(ctx, {
    enterpriseConnection: {
      value: {
        request: vi.fn(async (path: string) => {
          if (path === 'employee/me' || path === 'employee/skill-catalog') catalogPaths.push(path)
          return path.endsWith('/download')
            ? new Response(archive)
            : Response.json({
              employee: { id: employee },
              skills: enterpriseAllowed
                ? [
                  {
                    id: 'enterprise-1',
                    name: '企业技能',
                    description: '企业简介',
                    version: '2.0',
                    sha256,
                    ...(path === 'employee/me' ? { icon: 'data:image/png;base64,aWNvbg==' } : {}),
                  },
                ]
                : [],
            })
        }),
      },
    },
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route)
            return () => {}
          },
        },
      },
    },
    tools: { value: { register: tools.mockReturnValue(() => {}) } },
    skills: {
      value: {
        registerProvider: (factory: (control: SkillProviderControl) => SkillProvider) => {
          const next = factory({ signal: new AbortController().signal, invalidate })
          providers.set(next.name, next)
          if (next.name === 'lfclaw-personal') provider = next
          return () => {}
        },
      },
    },
  })
  apply(ctx, { dataDirectory, refreshIntervalMs: 30000, maxArchiveBytes: 10000, maxUnpackedBytes: 20000, maxFiles: 20 })
  const tool = tools.mock.calls[0]![0]
  const saved = await tool.execute(
    { name: 'report-helper', description: '整理日报', instructions: '先检查输入，然后输出摘要' },
    {},
  )
  expect(Object.keys(saved).sort()).toEqual(['description', 'invocationName', 'name'])
  expect(tool.output.render({}, saved)).toMatchInlineSnapshot(`
    [
      {
        "text": "已保存到我的技能：report-helper。调用名称：my-report-helper。整理日报",
        "type": "text",
      },
    ]
  `)
  expect(invalidate).toHaveBeenCalled()
  const list = await provider!.list({})
  if (!Array.isArray(list)) throw new Error('expected candidates')
  expect(list[0].name).toBe('my-report-helper')
  expect((await provider!.get(list[0], {}))?.content).toContain('检查输入')
  const readTool = tools.mock.calls[1]![0]
  const updateTool = tools.mock.calls[2]![0]
  const original = await readTool.execute({ name: 'report-helper' }, {})
  expect(original.instructions).toContain('检查输入')
  const updated = await updateTool.execute(
    { name: 'report-helper', revision: original.revision, description: '整理日报并校验', instructions: '先检查输入，再校验结果' },
    {},
  )
  expect(updated).toMatchObject({ description: '整理日报并校验', version: '1.0.1' })
  await expect(
    updateTool.execute(
      { name: 'report-helper', revision: original.revision, description: '过期修改', instructions: '错误覆盖' },
      {},
    ),
  ).rejects.toThrow('重新读取')
  expect((await provider!.get(list[0], {}))?.content).toContain('校验结果')
  expect(catalogPaths.length).toBeGreaterThan(0)
  expect(new Set(catalogPaths)).toEqual(new Set(['employee/skill-catalog']))
  const route = routes.get('/api/lfclaw/skill-center')!
  const response = await route.fetch(new Request('http://localhost/api/lfclaw/skill-center?employee=someone-else'))
  expect(await response.json()).toMatchObject({
    enterprise: [{ name: '企业技能', version: '2.0', icon: 'data:image/png;base64,aWNvbg==' }],
    personal: [{ name: 'report-helper' }],
  })
  expect(routes.has('/api/lfclaw/personal-skills/toggle')).toBe(false)
  expect(catalogPaths.at(-1)).toBe('employee/me')
  catalogPaths.length = 0
  const enterprise = providers.get('lfclaw-enterprise')!
  const enterpriseCatalog = await enterprise.list({})
  if (Array.isArray(enterpriseCatalog)) throw new Error('expected observation')
  const candidates = 'candidates' in enterpriseCatalog ? enterpriseCatalog.candidates : []
  const candidate = candidates[0]!
  expect((await enterprise.get(candidate, {}))?.content).toContain('企业日报流程')
  enterpriseAllowed = false
  expect(await enterprise.get(candidate, {})).toBeUndefined()
  expect(catalogPaths).toEqual(['employee/skill-catalog', 'employee/skill-catalog', 'employee/skill-catalog'])
  enterpriseAllowed = true
  const removed = await routes
    .get('/api/lfclaw/personal-skills/remove')!
    .fetch(
      new Request('http://localhost/api/lfclaw/personal-skills/remove', {
        method: 'POST',
        body: JSON.stringify({ name: 'report-helper', employeeId: 'other-person' }),
      }),
    )
  expect(removed.status).toBe(204)
  expect(await provider!.get(list[0], {})).toBeUndefined()
  employee = 'employee-b'
  expect(await provider!.get(list[0], {})).toBeUndefined()
  expect(await (await route.fetch(new Request('http://localhost/api/lfclaw/skill-center'))).json()).toMatchObject({
    personal: [],
  })
  const imported = await routes
    .get('/api/lfclaw/personal-skills/import')!
    .fetch(new Request('http://localhost/api/lfclaw/personal-skills/import', { method: 'POST', body: 'broken archive' }))
  expect(imported.status).toBe(400)
  expect(await imported.json()).toEqual({ code: 'archive' })
  await ctx.fiber.dispose()
})
