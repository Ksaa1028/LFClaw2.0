/** Model tools persist personal expert configurations using Host-owned employee credentials. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-ui-activation'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('专家服务响应格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('专家服务响应格式无效')
  return value
}
function strings(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string'))
    throw new Error('专家服务响应格式无效')
  return value
}
function resources(value: unknown) {
  if (!Array.isArray(value)) throw new Error('专家服务响应格式无效')
  return value.map((item) => {
    const entry = record(item)
    return { id: text(entry.id), name: text(entry.name) }
  })
}
const listFields = { type: 'array', items: { type: 'string' } } as const
const definitionFields = {
  name: { type: 'string', required: true, description: '专家名称，最多40字' },
  description: { type: 'string', required: true, description: '专家简介，最多160字' },
  instructions: { type: 'string', required: true, description: '工作职责、步骤和输出规范，最多4000字' },
  kind: { type: 'string', enum: ['expert', 'team'], required: true, description: '单专家或个人专家团' },
  tags: { ...listFields, required: true, description: '最多5个标签，每个最多20字' },
  memberIds: { ...listFields, required: true, description: '专家团按顺序选择2至10位本人单专家ID，单专家传空数组' },
  skillIds: { ...listFields, required: true, description: '所需企业技能真实ID，不需要时传空数组' },
  connectorIds: { ...listFields, required: true, description: '所需企业连接器真实ID，不需要时传空数组' },
  quickPrompts: { ...listFields, required: true, description: '最多3个示例问题，每个最多300字' },
} as const
const resourceSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true } },
  },
} as const

/** Register conversation tools; every read and write resolves current employee authorization.
 * @param ctx - Host services; tools disappear when the plugin unloads.
 */
export function mountExpertTools(ctx: Context): void {
  async function request(path: string, signal: AbortSignal, body?: object, method = body ? 'POST' : 'GET'): Promise<unknown> {
    let response: Response
    try {
      response = await ctx.enterpriseConnection.request(path, {
        method,
        signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
    } catch (error) {
      throw new Error(body ? '无法确认专家保存结果，请先读取列表核对，勿重复创建' : '无法连接专家服务，请稍后重试', {
        cause: error,
      })
    }
    let value: unknown
    try {
      value = await response.json()
    } catch (error) {
      throw new Error(body ? '无法确认专家保存结果，请先读取列表核对，勿重复创建' : '专家服务响应格式无效', { cause: error })
    }
    if (!response.ok) {
      const failure = record(value)
      throw new Error(typeof failure.message === 'string' ? failure.message : '专家操作被拒绝，请检查当前账号权限')
    }
    return value
  }
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'list_expert_resources',
          description:
            '读取当前员工本人的专家及当前授权的企业技能、连接器，供对话式创建和修改专家使用。不返回他人的个人专家或密钥。',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                personalExperts: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      name: { type: 'string', required: true },
                      kind: { type: 'string', required: true },
                    },
                  },
                },
                skills: { ...resourceSchema, required: true },
                connectors: { ...resourceSchema, required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          presentCall: () => ({ card: 'generic', title: '读取专家和可用能力', kind: 'read' }),
          async execute(_args, exec) {
            const catalog = record(await request('employee/me', exec.signal))
            if (!Array.isArray(catalog.personalExperts)) throw new Error('专家服务响应格式无效')
            return {
              personalExperts: catalog.personalExperts.map((item) => {
                const value = record(item)
                return { id: text(value.id), name: text(value.name), kind: value.kind === 'team' ? 'team' : 'expert' }
              }),
              skills: resources(catalog.skills),
              connectors: resources(catalog.connectors),
            }
          },
        }),
      ),
    'lfclaw: expert resources tool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'read_personal_expert',
          description: '修改前读取本人指定专家的完整工作配置和当前修订摘要。仅支持本人专家。',
          parameters: { id: { type: 'string', required: true, description: 'list_expert_resources返回的本人专家ID' } },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ...definitionFields,
                id: { type: 'string', required: true },
                revision: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          presentCall: () => ({ card: 'generic', title: '读取个人专家配置', kind: 'read' }),
          async execute(args, exec) {
            if (!args.id.trim()) throw new Error('请指定要读取的个人专家ID')
            const value = record(await request(`employee/personal-experts/${encodeURIComponent(args.id)}`, exec.signal))
            const kind: 'expert' | 'team' = value.kind === 'team' ? 'team' : 'expert'
            return {
              id: text(value.id),
              revision: text(value.revision),
              name: text(value.name),
              description: text(value.description),
              instructions: text(value.instructions),
              kind,
              tags: strings(value.tags),
              memberIds: strings(value.memberIds),
              skillIds: strings(value.skillIds),
              connectorIds: strings(value.connectorIds),
              quickPrompts: strings(value.quickPrompts),
            }
          },
        }),
      ),
    'lfclaw: read personal expert tool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'save_personal_expert',
          description:
            '用户要求创建或修改专家后保存本人配置。创建省略id和revision；修改必须先读取原配置并携带id和revision，不覆盖其他人的配置。只有成功返回才算完成。',
          parameters: {
            ...definitionFields,
            id: { type: 'string', description: '修改已有专家的ID；创建时省略' },
            revision: { type: 'string', description: 'read_personal_expert返回的修订摘要；修改时必填' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                kind: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: `已保存到专家中心：${value.name}（${value.id}）` }],
          },
          presentCall: args => ({ card: 'generic', title: `保存个人专家：${args.name}` }),
          async execute(args, exec) {
            if (args.kind === 'team' && args.id === undefined)
              throw new Error('新建专家团请使用 create_personal_expert_team 一次保存成员和专家团')
            if (args.id !== undefined && (!args.id.trim() || !args.revision))
              throw new Error('修改前请先读取当前专家配置和修订摘要')
            if (args.revision !== undefined && args.id === undefined) throw new Error('修订摘要必须与要修改的个人专家ID一起使用')
            const { id, revision, ...definition } = args
            const response = await request(
              id ? `employee/personal-experts/${encodeURIComponent(id)}` : 'employee/personal-experts',
              exec.signal,
              { ...definition, ...(id ? { expectedRevision: revision } : {}) },
              id ? 'PUT' : 'POST',
            )
            try {
              const value = record(response)
              return { id: text(value.id), name: text(value.name), kind: value.kind === 'team' ? 'team' : 'expert' }
            } catch (error) {
              throw new Error('保存响应无法确认，请先读取专家列表核对，勿重复创建', { cause: error })
            }
          },
        }),
      ),
    'lfclaw: save personal expert tool',
  )
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'create_personal_expert_team',
          description:
            '一次创建个人专家团及缺少的成员，支持复用本人已有单专家。所有成员和依赖校验通过后整组保存，失败不留下部分新成员。不要提前逐个保存新成员。',
          parameters: {
            team: {
              type: 'object',
              required: true,
              additionalProperties: false,
              properties: {
                ...definitionFields,
                kind: { type: 'string', required: true, enum: ['team'] },
                memberIds: {
                  ...listFields,
                  required: true,
                  description: '按执行顺序列出2至10位成员；已有成员用真实ID，新成员用new:加对应key',
                },
              },
            },
            newMembers: {
              type: 'array',
              required: true,
              description: '本次要新建的成员；全部复用时传空数组',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  key: {
                    type: 'string',
                    required: true,
                    description: '本次请求内唯一临时标识，1至60位英文字母数字下划线或连字符',
                  },
                  definition: {
                    type: 'object',
                    required: true,
                    additionalProperties: false,
                    properties: { ...definitionFields, kind: { type: 'string', required: true, enum: ['expert'] } },
                  },
                },
              },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                createdMembers: { type: 'number', required: true },
              },
            },
            render: (_args, value) => [
              {
                type: 'text',
                text: '已整组保存到专家中心：' + value.name + '（' + value.id + '），新增成员 ' + value.createdMembers + ' 位',
              },
            ],
          },
          presentCall: args => ({ card: 'generic', title: '创建专家团：' + args.team.name }),
          async execute(args, exec) {
            const response = await request('employee/personal-expert-teams', exec.signal, args)
            try {
              const result = record(response),
                team = record(result.team)
              if (!Array.isArray(result.members)) throw new Error('专家团响应无效')
              return { id: text(team.id), name: text(team.name), createdMembers: result.members.length }
            } catch (error) {
              throw new Error('保存响应无法确认，请先读取专家列表核对，勿重复创建', { cause: error })
            }
          },
        }),
      ),
    'lfclaw: atomic personal team tool',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'call_enterprise_expert',
          description: '调用已授权的企业远程专家，返回远程平台的实际答复。仅当用户选择远程专家时使用；不得模拟调用结果。',
          parameters: {
            id: { type: 'string', required: true, description: '专家引用中给出的企业专家 ID' },
            prompt: { type: 'string', required: true, description: '需要远程专家处理的完整用户任务，最多 10000 字' },
            sessionId: { type: 'string', description: '上次调用返回的远程会话 ID，首次调用时省略' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string', required: true },
                sessionId: { type: 'string' },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          presentCall: () => ({ card: 'generic', title: '调用企业专家', kind: 'read' }),
          async execute(args, exec) {
            if (!args.id.trim() || !args.prompt.trim()) throw new Error('请提供企业专家和任务内容')
            let response: Response
            try {
              response = await ctx.enterpriseConnection.request(`employee/experts/${encodeURIComponent(args.id)}/chat`, {
                method: 'POST',
                signal: exec.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: args.prompt, ...(args.sessionId ? { sessionId: args.sessionId } : {}) }),
              })
            } catch (error) {
              throw new Error('企业专家调用未返回结果，请稍后重试', { cause: error })
            }
            let value: unknown
            try {
              value = await response.json()
            } catch (error) {
              throw new Error('企业专家返回内容无效', { cause: error })
            }
            if (!response.ok) {
              const failure = record(value)
              throw new Error(typeof failure.message === 'string' ? failure.message : '企业专家调用失败')
            }
            const result = record(value)
            return { text: text(result.text), ...(typeof result.sessionId === 'string' ? { sessionId: result.sessionId } : {}) }
          },
        }),
      ),
    'lfclaw: remote enterprise expert tool',
  )
}
