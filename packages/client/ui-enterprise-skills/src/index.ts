import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EnterpriseSkills, enterpriseInvocation, type EnterpriseSkill } from './enterprise.ts'
/** LFClaw 技能中心 Host：员工目录、本机个人技能和对话保存工具。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-ui-activation'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { validateSkillArchive } from './archive.ts'
import { PersonalSkills, SkillError, type Limits } from './store.ts'

/** 插件标识。 */
export const name = 'lfclaw-skill-center'
/** Host 服务依赖。 */
export const inject = ['connection', 'enterpriseConnection', 'skills', 'tools']
/** 本机存储位置与导入限制。 */
export interface Config extends Limits {
  /** Directory for installed personal skills and local metadata. */
  dataDirectory: string
  /** Minimum time between enterprise skill refreshes, in milliseconds. */
  refreshIntervalMs: number
}
/** 启动时校验全部部署配置。 */
export const Config: z<Config> = z.object({
  refreshIntervalMs: z.number().min(1000).required(),
  dataDirectory: z.string().required(),
  maxArchiveBytes: z.number().min(1).required(),
  maxUnpackedBytes: z.number().min(1).required(),
  maxFiles: z.number().min(1).required(),
})

function nextVersion(version: string): string {
  const parts = /^\d+(?:\.\d+)*$/.test(version) ? version.split('.') : ['1', '0', '0']
  const last = parts.length - 1
  parts[last] = String(Number(parts[last]) + 1)
  return parts.join('.')
}

/** 企业服务返回的已授权技能目录。 */
interface EmployeeCatalog {
  employee: { id: string }
  skills: EnterpriseSkill[]
}
function catalog(value: unknown): EmployeeCatalog {
  if (
    !value ||
    typeof value !== 'object' ||
    !('employee' in value) ||
    !value.employee ||
    typeof value.employee !== 'object' ||
    !('id' in value.employee) ||
    typeof value.employee.id !== 'string' ||
    !('skills' in value) ||
    !Array.isArray(value.skills)
  )
    throw new Error('enterprise-response')
  const skills = value.skills.map((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !('name' in item) ||
      typeof item.name !== 'string' ||
      !('description' in item) ||
      typeof item.description !== 'string' ||
      !('version' in item) ||
      typeof item.version !== 'string'
    )
      throw new Error('enterprise-response')
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      version: item.version,
      sha256: 'sha256' in item && typeof item.sha256 === 'string' ? item.sha256 : '',
      ...('icon' in item && typeof item.icon === 'string' ? { icon: item.icon } : {}),
    }
  })
  return { employee: { id: value.employee.id }, skills }
}

/** 注册本机技能接口和标准技能提供者。 @param ctx - Host 上下文。 @param config - 部署配置。 */
export function apply(ctx: Context, config: Config): void {
  const store = new PersonalSkills(config.dataDirectory, config)
  const lifetime = new AbortController()
  const work = new Set<Promise<unknown>>()
  const preparations = new Map<string, Promise<unknown>>()
  const enterprise = new EnterpriseSkills(join(config.dataDirectory, '.enterprise'), config, path =>
    ctx.enterpriseConnection.request(path, { signal: lifetime.signal }),
  )
  async function current(catalogMaxAgeMs = 0, display = false): Promise<EmployeeCatalog> {
    const response = await ctx.enterpriseConnection.request(display ? 'employee/skill-catalog?icons=1' : 'employee/skill-catalog', {
      signal: lifetime.signal, catalogMaxAgeMs,
    })
    if (!response.ok) throw new Error('activation-required')
    return catalog(await response.json())
  }
  let device: Promise<string> | undefined
  const deviceId = (): Promise<string> =>
    (device ??= (async () => {
      await mkdir(config.dataDirectory, { recursive: true })
      const path = join(config.dataDirectory, '.device-id')
      try {
        return (await readFile(path, 'utf8')).trim()
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      const value = randomUUID()
      try {
        await writeFile(path, value, { flag: 'wx', mode: 0o600 })
        return value
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
        return (await readFile(path, 'utf8')).trim()
      }
    })())
  async function report(me: EmployeeCatalog): Promise<boolean> {
    try {
      const personal = await store.list(me.employee.id)
      const response = await ctx.enterpriseConnection.request('employee/personal-skills/report', {
        method: 'POST',
        signal: lifetime.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: me.employee.id,
          deviceId: await deviceId(),
          skills: personal
            .filter(item => !item.error)
            .map(item => ({
              name: item.name,
              description: item.description,
              version: item.version,
              source: 'personal',
              enabled: item.enabled,
            })),
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return true
    } catch (error) {
      if (!lifetime.signal.aborted)
        ctx.logger.warn('个人技能已保存在本机，管理清单待同步：%s', error instanceof Error ? error.message : 'unknown')
      return false
    }
  }
  const prepared = new Map<string, { invocationName?: string; ready: boolean; loading: boolean; userInvocable?: boolean }>()
  function prepare(me: EmployeeCatalog, resource: EnterpriseSkill) {
    const key = `${me.employee.id}:${resource.id}:${resource.sha256}`
    const existing = prepared.get(key)
    if (existing) return existing
    const state = { ready: false, loading: true }
    prepared.set(key, state)
    const task = enterprise
      .load(me.employee.id, resource)
      .then(
        (item) => {
          prepared.set(key, {
            ready: true,
            loading: false,
            invocationName: enterpriseInvocation(resource.id, item.name),
            userInvocable: item.invocation.userInvocable,
          })
        },
        () => {
          prepared.set(key, { ready: false, loading: false })
        },
      )
      .finally(() => {
        work.delete(task)
        preparations.delete(key)
        invalidateEnterprise()
      })
    work.add(task)
    preparations.set(key, task)
    return state
  }
  let invalidate = () => {}
  let invalidateEnterprise = () => {}
  ctx.effect(
    () =>
      ctx.skills.registerProvider((control) => {
        invalidate = control.invalidate
        return {
          name: 'lfclaw-personal',
          async list() {
            const me = await current()
            return Promise.all(
              (await store.list(me.employee.id))
                .filter(item => item.enabled && !item.error)
                .map(async (item) => {
                  const value = await store.read(me.employee.id, item.name)
                  return {
                    name: item.invocationName,
                    description: item.description,
                    source: 'user-dsh',
                    provider: 'lfclaw-personal',
                    rank: 400,
                    locator: { employee: me.employee.id, name: item.name },
                    invocation: value.invocation,
                    path: value.path,
                    resourceBase: { kind: 'directory' as const, path: value.directory },
                  }
                }),
            )
          },
          async get(candidate) {
            const me = await current()
            const locator = candidate.locator
            if (
              !locator ||
              typeof locator !== 'object' ||
              !('employee' in locator) ||
              locator.employee !== me.employee.id ||
              !('name' in locator) ||
              typeof locator.name !== 'string'
            )
              return undefined
            const item = await store.read(me.employee.id, locator.name).catch((error: unknown) => {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
              throw error
            })
            if (!item || !item.enabled) return undefined
            return {
              name: `my-${item.name}`,
              displayName: item.name,
              description: item.description,
              content: item.content,
              invocation: item.invocation,
              source: 'user-dsh',
              provider: 'lfclaw-personal',
              path: item.path,
              resourceBase: { kind: 'directory', path: item.directory },
            }
          },
        }
      }),
    'lfclaw: personal skill provider',
  )
  ctx.effect(
    () =>
      ctx.skills.registerProvider((control) => {
        invalidateEnterprise = control.invalidate
        return {
          name: 'lfclaw-enterprise',
          async list() {
            const me = await current()
            const candidates = []
            let complete = true
            for (const resource of me.skills) {
              try {
                const item = await enterprise.load(me.employee.id, resource)
                candidates.push({
                  name: enterpriseInvocation(resource.id, item.name),
                  description: `${resource.name}（版本 ${resource.version}）：${resource.description}`,
                  source: 'enterprise',
                  provider: 'lfclaw-enterprise',
                  rank: 350,
                  invocation: item.invocation,
                  locator: { employee: me.employee.id, id: resource.id },
                  path: item.path,
                  resourceBase: { kind: 'directory' as const, path: item.directory },
                })
              } catch (error) {
                complete = false
                ctx.logger.warn('企业技能加载失败：%s', error instanceof Error ? error.message : 'unknown')
              }
            }
            return { candidates, complete }
          },
          async get(candidate) {
            const me = await current()
            const locator = candidate.locator
            if (
              !locator ||
              typeof locator !== 'object' ||
              !('employee' in locator) ||
              locator.employee !== me.employee.id ||
              !('id' in locator)
            )
              return undefined
            const resource = me.skills.find(item => item.id === locator.id)
            if (!resource) return undefined
            const item = await enterprise.load(me.employee.id, resource)
            if (candidate.name !== enterpriseInvocation(resource.id, item.name)) return undefined
            return {
              name: candidate.name,
              displayName: resource.name,
              description: resource.description,
              content: item.content,
              invocation: item.invocation,
              source: 'enterprise',
              provider: 'lfclaw-enterprise',
              path: item.path,
              resourceBase: { kind: 'directory', path: item.directory },
            }
          },
        }
      }),
    'lfclaw: enterprise skill provider',
  )
  ctx.effect(() => {
    const refresh = () => {
      if (work.size) return
      const task = current()
        .then(async (me) => {
          invalidateEnterprise()
          for (const resource of me.skills) {
            const key = `${me.employee.id}:${resource.id}:${resource.sha256}`
            if (prepared.get(key)?.ready === false && !prepared.get(key)?.loading) prepared.delete(key)
            prepare(me, resource)
          }
          await report(me)
        })
        .catch((error: unknown) => {
          if (!lifetime.signal.aborted)
            ctx.logger.warn('技能目录同步失败，保留本机数据：%s', error instanceof Error ? error.message : 'unknown')
        })
        .finally(() => {
          work.delete(task)
        })
      work.add(task)
    }
    refresh()
    const timer = setInterval(refresh, config.refreshIntervalMs)
    return async () => {
      clearInterval(timer)
      lifetime.abort()
      await Promise.allSettled([...work])
    }
  }, 'lfclaw: refresh skill catalog')
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'save_personal_skill',
          description:
            '保存当前员工自己的可复用技能到本机。仅当用户明确要求创建并确认内容后调用；先讨论用途及步骤，不要把普通回答自动保存为技能。同名技能不能覆盖。',
          parameters: {
            name: { type: 'string', required: true, description: '小写英文和短横线组成的技能标识，最多 60 字符' },
            description: { type: 'string', required: true, description: '中文简介，说明功能和何时使用，最多 2000 字符' },
            instructions: {
              type: 'string',
              required: true,
              description: 'Markdown 技能正文，包含操作步骤、必要输入和输出要求，不含 YAML 头',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                invocationName: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [
              { type: 'text', text: `已保存到我的技能：${value.name}。调用名称：${value.invocationName}。${value.description}` },
            ],
          },
          async execute(args) {
            const me = await current()
            try {
              const result = await store.create(me.employee.id, args)
              invalidate()
              await report(me)
              return { name: result.name, description: result.description, invocationName: result.invocationName }
            } catch (error) {
              if (error instanceof SkillError)
                throw new Error(
                  error.code === 'duplicate' ? '已有同名个人技能，请换一个名称' : '技能名称、简介或正文不符合要求，请修改后重试',
                )
              throw error
            }
          },
        }),
      ),
    'lfclaw: save personal skill tool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'read_personal_skill',
          description: '读取当前员工已有个人技能的完整正文和修订摘要，供对话修改前检查。只读取个人技能。',
          parameters: { name: { type: 'string', required: true, description: '个人技能的原始名称，不含 my- 前缀' } },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                instructions: { type: 'string', required: true },
                version: { type: 'string', required: true },
                revision: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute(args) {
            const me = await current()
            const item = await store.read(me.employee.id, args.name)
            return {
              name: item.name,
              description: item.description,
              instructions: item.content,
              version: item.version,
              revision: item.revision,
            }
          },
        }),
      ),
    'lfclaw: read personal skill tool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'update_personal_skill',
          description:
            '用户确认修改后的完整内容后，更新当前员工已有的同名个人技能。必须先用 read_personal_skill 读取当前修订摘要，展示修改内容并获得用户确认；冲突时重新读取并确认。保留附件、启停状态和调用设置，版本自动递增。',
          parameters: {
            name: { type: 'string', required: true, description: '要修改的个人技能原始名称' },
            revision: { type: 'string', required: true, description: '读取时返回的修订摘要' },
            description: { type: 'string', required: true, description: '确认后的完整简介' },
            instructions: { type: 'string', required: true, description: '确认后的完整 Markdown 正文，不含 YAML 头' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                version: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [
              { type: 'text', text: `已更新个人技能：${value.name}（版本 ${value.version}）。${value.description}` },
            ],
          },
          async execute(args) {
            const me = await current()
            const prior = await store.read(me.employee.id, args.name)
            if (prior.revision !== args.revision) throw new Error('技能已变化，请重新读取并让用户确认修改')
            const result = await store.update(
              me.employee.id,
              args.name,
              {
                description: args.description,
                instructions: args.instructions,
                enabled: prior.enabled,
                version: nextVersion(prior.version),
              },
              args.revision,
            )
            invalidate()
            await report(me)
            return { name: result.name, description: result.description, version: result.version }
          },
        }),
      ),
    'lfclaw: update personal skill tool',
  )
  for (const operation of ['skill-center', 'personal-skills/import', 'personal-skills/remove'])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `/api/lfclaw/${operation}`,
          methods: operation === 'skill-center' ? ['GET'] : ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              const me = await current(
                operation === 'skill-center' && new URL(request.url).searchParams.get('refresh') !== '1'
                  ? config.refreshIntervalMs
                  : 0,
                operation === 'skill-center' && new URL(request.url).searchParams.get('summary') !== '1'
                  && (new URL(request.url).searchParams.get('wait') !== '1' || new URL(request.url).searchParams.get('display') === '1'),
              )
              if (operation === 'skill-center') {
                if (new URL(request.url).searchParams.get('wait') !== '1') {
                  for (const resource of me.skills) {
                    const key = `${me.employee.id}:${resource.id}:${resource.sha256}`
                    const prior = prepared.get(key)
                    if (prior && !prior.ready && !prior.loading) prepared.delete(key)
                  }
                }
                for (const resource of me.skills) prepare(me, resource)
                if (new URL(request.url).searchParams.get('wait') === '1') {
                  await Promise.allSettled(
                    me.skills.flatMap((resource) => {
                      const task = preparations.get(`${me.employee.id}:${resource.id}:${resource.sha256}`)
                      return task ? [task] : []
                    }),
                  )
                }
                const items = me.skills.map(resource => ({ ...resource, ...prepare(me, resource) }))
                return Response.json({
                  displayPending: new URL(request.url).searchParams.get('summary') === '1',
                  enterprise: items,
                  personal: await store.list(me.employee.id),
                  maxArchiveBytes: config.maxArchiveBytes,
                  refreshIntervalMs: config.refreshIntervalMs,
                })
              }
              if (operation === 'personal-skills/remove') {
                const input: unknown = await request.json()
                if (!input || typeof input !== 'object' || !('name' in input) || typeof input.name !== 'string') {
                  return Response.json({ code: 'metadata' }, { status: 400 })
                }
                await store.remove(me.employee.id, input.name)
                invalidate()
                await report(me)
                return new Response(null, { status: 204 })
              }
              const bytes = new Uint8Array(await request.arrayBuffer())
              const revision = request.headers.get('If-Match') ?? undefined
              const definition = validateSkillArchive(bytes, config).parsed
              if (!revision) {
                try {
                  const prior = await store.read(me.employee.id, definition.name)
                  return Response.json({ code: 'duplicate', name: definition.name, revision: prior.revision }, { status: 409 })
                } catch (error) {
                  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
                }
              }
              const result = await store.import(me.employee.id, bytes, revision)
              invalidate()
              return Response.json({ ...result, metadataSynced: await report(me) }, { status: 201 })
            } catch (error) {
              if (error instanceof SyntaxError) return Response.json({ code: 'metadata' }, { status: 400 })
              if (error instanceof SkillError)
                return Response.json({ code: error.code }, { status: error.code === 'conflict' ? 409 : 400 })
              return Response.json({ code: 'unavailable' }, { status: 503 })
            }
          },
        }),
      `lfclaw: ${operation}`,
    )
}
