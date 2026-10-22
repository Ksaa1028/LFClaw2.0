import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateDatabase, type RecordItem } from '../src/store.ts'
import { expertCapabilities, prepareExpert, validExpertCapabilities } from '../src/expert-definition.ts'
import { validExpert } from '../src/expert.ts'
const employee = { id: 'e1' }
const local = (id: string): RecordItem => ({ id, name: id, description: '', instructions: '分析并核对',
  tags: [], source: 'dsh', enabled: true, scope: 'all', scopeTarget: [] })
function database() {
  return validateDatabase({ departments: [], employees: [employee], models: [], skills: [], connectors: [], experts: [],
    backups: [], versionPackages: [], operationLogs: [], recentActivities: [], notifications: [], systemErrors: [],
    personalSkillReports: [], personalExperts: [], modelUsage: [], employeeVersionReports: [], dashboardTrend: [], systemMetric: {} })
}
test('旧专家继续读取；可选能力限制数量、重复标识和示例长度', () => {
  assert.equal(validExpertCapabilities({}), true)
  for (const invalid of [{ skillIds: ['s1', 's1'] }, { connectorIds: [42] }, { kind: 'team', memberIds: ['a'] },
    { quickPrompts: ['a'.repeat(301)] }, { quickPrompts: ['1', '2', '3', '4'] }]) assert.equal(validExpertCapabilities(invalid), false)
  assert.deepEqual(expertCapabilities({ ownerEmployeeId: 'other', apiKey: 'secret' }),
    { kind: 'expert', memberIds: [], skillIds: [], connectorIds: [], quickPrompts: [] })
})
test('团队准备保留成员顺序并实时拒绝成员撤权、删除与外部服务', () => {
  const db = database()
  db.experts = [local('a'), local('b'), { ...local('team'), source: 'team', memberIds: ['b', 'a'] }]
  const result = prepareExpert(db, employee, 'enterprise', 'team')
  assert('definition' in result)
  assert.deepEqual(result.definition.members.map(member => member.name), ['b', 'a'])
  db.experts[0]!.enabled = false
  assert('error' in prepareExpert(db, employee, 'enterprise', 'team'))
  db.experts[0]!.enabled = true
  db.experts[0]!.source = 'bailian'
  assert('error' in prepareExpert(db, employee, 'enterprise', 'team'))
  db.experts.shift()
  assert('error' in prepareExpert(db, employee, 'enterprise', 'team'))
})
test('个人配置按本人隔离，团队不能读取别人的专家', () => {
  const db = database()
  db.personalExperts = [{ ...local('a'), ownerEmployeeId: 'e1' }, { ...local('b'), ownerEmployeeId: 'e2' },
    { ...local('team'), kind: 'team', ownerEmployeeId: 'e1', memberIds: ['a', 'b'] }]
  assert('error' in prepareExpert(db, employee, 'personal', 'b'))
  assert('error' in prepareExpert(db, employee, 'personal', 'team'))
  assert('definition' in prepareExpert(db, employee, 'personal', 'a'))
})
test('已授权的百炼专家准备远程调用标识，不下发服务端凭据', () => {
  const db = database()
  db.experts = [{ ...local('remote'), name: '数据查询', source: 'bailian',
    externalConfig: { appId: 'abc123', apiKey: 'secret' } }]
  const result = prepareExpert(db, employee, 'enterprise', 'remote')
  assert('definition' in result)
  assert.deepEqual(result.definition.remote, { id: 'remote', source: 'bailian' })
  assert.equal(JSON.stringify(result).includes('secret'), false)
  db.experts[0]!.enabled = false
  assert('error' in prepareExpert(db, employee, 'enterprise', 'remote'))
})
test('技能和连接器依赖不授予权限，成员依赖合并且去重', () => {
  const db = database()
  db.skills = [{ ...local('s1'), name: '经营分析' }]
  db.connectors = [{ ...local('c1'), name: '商场数据' }]
  db.experts = [{ ...local('a'), skillIds: ['s1'], connectorIds: ['c1'] },
    { ...local('b'), skillIds: ['s1'] }, { ...local('team'), source: 'team', memberIds: ['a', 'b'] }]
  assert.equal(validExpert({ ...local('x'), skillIds: ['missing'] }, db), false)
  const result = prepareExpert(db, employee, 'enterprise', 'team')
  assert('definition' in result)
  assert.deepEqual(result.definition.skills, [{ id: 's1', name: '经营分析' }])
  db.skills[0]!.employeeOverrides = { e1: 'deny' }
  assert('error' in prepareExpert(db, employee, 'enterprise', 'team'))
  delete db.skills[0]!.employeeOverrides
  db.connectors[0]!.enabled = false
  assert('error' in prepareExpert(db, employee, 'enterprise', 'team'))
})
