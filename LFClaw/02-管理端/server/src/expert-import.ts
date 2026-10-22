/** 原创专家参数导入，成员和专家团在同一次存储更新中发布。 */
import { randomUUID } from 'node:crypto'
import { validExpert } from './expert.ts'
import type { Database, RecordItem } from './store.ts'

/** 导入内容不符合专家参数要求。 */
export class ExpertImportError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExpertImportError('请导入有效的专家 JSON 对象')
  return value as Record<string, unknown>
}
function localized(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) return object(value).zh ?? object(value).en
  return value
}
function labels(value: unknown): unknown {
  return Array.isArray(value) ? value.map(localized) : value ?? []
}
/** WorkBuddy 导出包中的路径和资源清单只用于说明迁移缺口，不进入专家定义。 */
function workBuddyDefinition(input: Record<string, unknown>): { definition: Record<string, unknown>; migration: { source: string; skills: string[]; assets: number } } | null {
  if (input.schemaVersion === undefined || input.manifest === undefined || input.agent === undefined) return null
  if (input.schemaVersion !== '1.0') throw new ExpertImportError('暂不支持此版本的 WorkBuddy 专家包')
  const manifest = object(input.manifest)
  const agent = object(input.agent)
  if (manifest.expertType !== 'agent' || typeof agent.content !== 'string' || !agent.content.trim())
    throw new ExpertImportError('WorkBuddy 专家包缺少可迁移的角色指令')
  const skills = manifest.skills
  if (skills !== undefined && (!Array.isArray(skills) || !skills.every(skill => typeof skill === 'string')))
    throw new ExpertImportError('WorkBuddy 专家包的技能清单无效')
  const stats = input.stats === undefined ? {} : object(input.stats)
  return {
    definition: {
      name: manifest.displayName ?? manifest.name,
      description: manifest.displayDescription ?? manifest.description ?? '',
      instructions: agent.content,
      tags: manifest.tags ?? [], quickPrompts: manifest.quickPrompts ?? [],
    },
    migration: { source: 'WorkBuddy', skills: (skills ?? []).map(skill => String(skill).replace(/^\.\/skills\//, '')),
      assets: typeof stats.binaryFileCount === 'number' && Number.isSafeInteger(stats.binaryFileCount) && stats.binaryFileCount >= 0
        ? stats.binaryFileCount : 0 },
  }
}
/** 解析专家参数并校验引用；不修改传入数据库。
 * @param value - 单专家参数，或包含 expert 与 members 的专家团参数。
 * @param db - 当前企业目录。
 * @param settings - 发布范围、状态及可选的原专家 ID。
 * @returns 待原子保存的根专家与新增成员，以及可选的迁移提示。
 */
export function resolveExpertImport(value: unknown, db: Database, settings: Record<string, unknown>): { expert: RecordItem; members: RecordItem[]; migration?: { source: string; skills: string[]; assets: number } } {
  const input = object(value)
  const migrated = workBuddyDefinition(input)
  const root = migrated?.definition ?? (input.expert === undefined ? input : object(input.expert))
  const checkSource = (item: Record<string, unknown>) => {
    if (item.source !== undefined && !['dsh', 'original', 'native', 'team'].includes(String(item.source)))
      throw new ExpertImportError('此入口只接收原创专家参数，外部专家请通过接入入口配置')
    if (item.kind !== undefined && !['expert', 'team'].includes(String(item.kind)))
      throw new ExpertImportError('专家类型必须是 expert 或 team')
  }
  checkSource(root)
  const team = root.kind === 'team' || root.expertType === 'team' || root.source === 'team'
  const target = settings.targetId
  if (target !== undefined && (typeof target !== 'string' || !db.experts.some(item => item.id === target && ['dsh', 'team'].includes(String(item.source)))))
    throw new ExpertImportError('要更新的原创专家不存在，请刷新列表')
  const scope = { scope: settings.scope, scopeTarget: settings.scopeTarget, enabled: settings.enabled }
  const convert = (item: Record<string, unknown>, id: string, isTeam: boolean): RecordItem => ({
    id, name: localized(item.name ?? item.profession ?? item.displayName),
    description: localized(item.description ?? item.displayDescription) ?? '',
    instructions: item.instructions, tags: labels(item.tags), quickPrompts: labels(item.quickPrompts),
    skillIds: item.skillIds ?? [], connectorIds: item.connectorIds ?? [], ...scope,
    source: isTeam ? 'team' : 'dsh', ...(isTeam ? { memberIds: item.memberIds ?? [] } : {}),
  })
  const members: RecordItem[] = []
  const memberMap = new Map<string, string>()
  if (input.members !== undefined) {
    if (!team || !Array.isArray(input.members) || input.members.length < 2 || input.members.length > 10) throw new ExpertImportError('专家团需要 2–10 位成员')
    for (const entry of input.members) {
      const member = object(entry)
      checkSource(member)
      if (typeof member.id !== 'string' || !member.id.trim() || memberMap.has(member.id)
        || member.kind === 'team' || member.expertType === 'team' || member.source === 'team') throw new ExpertImportError('成员标识必须唯一，且不能嵌套专家团')
      const id = randomUUID()
      memberMap.set(member.id, id)
      members.push(convert(member, id, false))
    }
  }
  const expert = convert(root, typeof target === 'string' ? target : randomUUID(), team)
  if (team && members.length) {
    if (!Array.isArray(root.memberIds)) expert.memberIds = [...memberMap.values()]
    else {
      if (root.memberIds.length !== members.length || !root.memberIds.every(id => typeof id === 'string' && memberMap.has(id))) throw new ExpertImportError('专家团成员顺序必须覆盖全部导入成员')
      expert.memberIds = root.memberIds.map(id => memberMap.get(String(id)))
    }
  }
  const candidate: Database = { ...db, experts: [...db.experts.filter(item => item.id !== expert.id), ...members] }
  for (const member of members) if (!validExpert(member, candidate)) throw new ExpertImportError('成员参数或所需企业能力无效')
  if (!validExpert(expert, candidate)) throw new ExpertImportError('专家参数、工作指令、成员或发布范围无效')
  if (team && Array.isArray(expert.memberIds) && expert.memberIds.some(id => !candidate.experts.some(member => member.id === id && member.source === 'dsh')))
    throw new ExpertImportError('当前专家团只支持原创成员，外部专家混合编排尚未开放')
  if (expert.source === 'team' && db.experts.some(item => item.id !== expert.id && Array.isArray(item.memberIds) && item.memberIds.includes(expert.id)))
    throw new ExpertImportError('该专家正在被其他专家团引用，不能改为专家团')
  return { expert, members, ...(migrated ? { migration: migrated.migration } : {}) }
}
