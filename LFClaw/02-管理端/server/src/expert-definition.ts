/** 专家能力声明与启动前的实时授权检查；不向客户端返回外部凭据。 */
import { authorizationFor } from './authorization.ts'
import { createHash } from 'node:crypto'
import type { Database, RecordItem } from './store.ts'

/** 当前个人配置的修订摘要用于对话修改时拒绝覆盖较新的内容。 */
export function expertRevision(item: RecordItem): string { return createHash('sha256').update(JSON.stringify(item)).digest('hex') }

function ids(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit
    && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)
    && new Set(value).size === value.length
}

/** 校验可选能力声明；未声明字段的既有专家继续按单专家读取。 */
export function validExpertCapabilities(item: Record<string, unknown>): boolean {
  return (item.skillIds === undefined || ids(item.skillIds, 30))
    && (item.connectorIds === undefined || ids(item.connectorIds, 30))
    && (item.quickPrompts === undefined || Array.isArray(item.quickPrompts) && item.quickPrompts.length <= 3
      && item.quickPrompts.every(prompt => typeof prompt === 'string' && !!prompt.trim() && prompt.length <= 300))
    && (item.kind === undefined || item.kind === 'expert' || item.kind === 'team')
    && (item.kind !== 'team' || ids(item.memberIds, 10) && item.memberIds.length >= 2)
}

/** 仅保留员工可编辑的扩展字段；管理员范围和凭据不能从个人配置写入。 */
export function expertCapabilities(item: Record<string, unknown>): Record<string, unknown> {
  return { kind: item.kind === 'team' ? 'team' : 'expert',
    memberIds: item.kind === 'team' ? item.memberIds : [],
    skillIds: item.skillIds ?? [], connectorIds: item.connectorIds ?? [], quickPrompts: item.quickPrompts ?? [] }
}

/** 保存个人配置时只允许选择本人单专家和当前已授权的企业能力。 */
export function personalReferencesAllowed(db: Database, employee: RecordItem, item: Record<string, unknown>, id?: string): boolean {
  if (item.kind === 'team' && (!ids(item.memberIds, 10) || !item.memberIds.every(memberId => db.personalExperts.some(member =>
    member.id === memberId && member.id !== id && member.ownerEmployeeId === employee.id && member.kind !== 'team')))) return false
  for (const [field, collection] of [['skillIds', 'skills'], ['connectorIds', 'connectors']] as const) {
    const required = item[field]
    if (required !== undefined && (!ids(required, 30) || !required.every(resourceId => db[collection].some(resource =>
      resource.id === resourceId && authorizationFor(resource, employee, db).allowed)))) return false
  }
  return true
}

/** 准备本机对话用的专家定义；每次重新检查成员、能力授权和个人归属。 */
export function prepareExpert(db: Database, employee: RecordItem, owner: unknown, id: unknown):
  { definition: { name: string; instructions: string; members: Array<{ name: string; instructions: string }>;
    skills: Array<{ id: string; name: string }>; connectors: Array<{ id: string; name: string }>;
    remote?: { id: string; source: 'bailian' | 'dify' | 'weknora' } } } | { error: string } {
  if (typeof id !== 'string' || !['enterprise', 'personal'].includes(String(owner))) return { error: '专家选择无效' }
  const visible = (item: RecordItem, personal: boolean) => personal
    ? item.ownerEmployeeId === employee.id : authorizationFor(item, employee, db).allowed
  const personal = owner === 'personal'
  const expert = (personal ? db.personalExperts : db.experts).find(item => item.id === id && visible(item, personal))
  if (!expert) return { error: '专家已删除或你没有使用权限，请刷新列表' }
  if (!personal && (expert.source === 'bailian' || expert.source === 'dify' || expert.source === 'weknora')) return { definition: { name: String(expert.name), instructions: '',
    members: [], skills: [], connectors: [], remote: { id: expert.id, source: expert.source } } }
  const members: RecordItem[] = []
  if (expert.kind === 'team' || expert.source === 'team') {
    if (!ids(expert.memberIds, 10) || expert.memberIds.length < 2) return { error: '请为专家团选择至少两位成员' }
    for (const memberId of expert.memberIds) {
      const member = (personal ? db.personalExperts : db.experts).find(item => item.id === memberId && visible(item, personal))
      if (!member || member.id === expert.id || member.kind === 'team' || member.source === 'team')
        return { error: '专家团成员已变更或授权不足，请检查成员配置' }
      members.push(member)
    }
  }
  const resources = [expert, ...members]
  if (resources.some(item => !personal && item.source !== 'dsh' && item.source !== 'team'))
    return { error: '该专家使用外部服务，当前不能作为本机专家启动' }
  if (resources.some(item => typeof item.instructions !== 'string' || !item.instructions.trim()))
    return { error: '专家工作指令缺失，请编辑后再使用' }
  const required = (key: 'skillIds' | 'connectorIds', collection: 'skills' | 'connectors') => {
    const found = new Map<string, { id: string; name: string }>()
    for (const item of resources) {
      if (item[key] !== undefined && !ids(item[key], 30)) return null
      for (const resourceId of item[key] as string[] | undefined ?? []) {
        const resource = db[collection].find(value => value.id === resourceId && authorizationFor(value, employee, db).allowed)
        if (!resource || typeof resource.name !== 'string') return null
        found.set(resourceId, { id: resourceId, name: resource.name })
      }
    }
    return [...found.values()]
  }
  const skills = required('skillIds', 'skills')
  const connectors = required('connectorIds', 'connectors')
  if (!skills || !connectors) return { error: '所需技能或连接器已停用或未授权，请联系管理员' }
  return { definition: { name: String(expert.name), instructions: String(expert.instructions),
    members: members.map(item => ({ name: String(item.name), instructions: String(item.instructions) })), skills, connectors } }
}

/** 校验个人专家基本内容及可选能力参数。 */
export function validPersonalExpert(value: unknown): value is Record<string, unknown> {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  return !!item && typeof item.name === 'string' && !!item.name.trim() && item.name.length <= 40
    && typeof item.description === 'string' && item.description.length <= 160
    && typeof item.instructions === 'string' && !!item.instructions.trim() && item.instructions.length <= 4000
    && Array.isArray(item.tags) && item.tags.length <= 5
    && item.tags.every(tag => typeof tag === 'string' && tag.length <= 20)
    && validExpertCapabilities(item)
}
