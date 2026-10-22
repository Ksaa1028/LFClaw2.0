/** 将已有成员引用和新成员参数一起解析，全部校验后才交给调用方保存。 */
import { randomUUID } from 'node:crypto'
import { expertCapabilities, personalReferencesAllowed, validPersonalExpert } from './expert-definition.ts'
import type { Database, RecordItem } from './store.ts'

/** 专家团参数或成员授权无效。 */
export class PersonalTeamError extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalTeamError('专家团参数无效')
  return value as Record<string, unknown>
}
/** 解析整组创建请求；不修改已有专家或传入数据库。
 * @param value - team.memberIds 使用已有 ID 或 new:临时标识；newMembers 包含 key 和 definition。
 * @param db - 保存时的最新资源目录。
 * @param employee - 当前员工。
 * @returns 待一起保存的专家团和新增成员，复用的成员保持原样。
 */
export function resolvePersonalTeam(value: unknown, db: Database, employee: RecordItem): { team: RecordItem; members: RecordItem[] } {
  const input = object(value), team = object(input.team)
  if (!validPersonalExpert(team) || team.kind !== 'team' || !Array.isArray(input.newMembers) || input.newMembers.length > 10)
    throw new PersonalTeamError('请提供专家团和最多十位新成员的完整参数')
  const now = new Date().toISOString()
  const create = (definition: Record<string, unknown>): RecordItem => ({ id: randomUUID(), ownerEmployeeId: employee.id,
    source: 'personal', name: String(definition.name).trim(), description: String(definition.description).trim(),
    instructions: String(definition.instructions).trim(), tags: definition.tags, ...expertCapabilities(definition), createdAt: now, updatedAt: now })
  const mapping = new Map<string, string>(), members: RecordItem[] = []
  for (const value of input.newMembers) {
    const entry = object(value), definition = object(entry.definition)
    if (typeof entry.key !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(entry.key) || mapping.has(entry.key)
      || !validPersonalExpert(definition) || definition.kind !== 'expert' || !personalReferencesAllowed(db, employee, definition))
      throw new PersonalTeamError('新成员标识重复、参数无效或依赖未授权')
    const member = create(definition)
    members.push(member); mapping.set(entry.key, member.id)
  }
  const refs = team.memberIds as string[]
  for (const key of mapping.keys()) if (!refs.includes(`new:${key}`)) throw new PersonalTeamError('新成员必须被专家团引用')
  const resolved = create({ ...team, memberIds: refs.map(ref => ref.startsWith('new:') ? mapping.get(ref.slice(4)) ?? ref : ref) })
  const candidate = { ...db, personalExperts: [...db.personalExperts, ...members] }
  if (!personalReferencesAllowed(candidate, employee, resolved)) throw new PersonalTeamError('成员不存在、不是本人的单专家，或依赖已失效，请重新读取资源')
  return { team: resolved, members }
}
