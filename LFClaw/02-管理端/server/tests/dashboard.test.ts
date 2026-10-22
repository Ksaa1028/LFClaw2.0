import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dashboardData } from '../src/dashboard.ts'
import { resourceOperationSummary } from '../src/operation-summary.ts'
import type { Database, RecordItem } from '../src/store.ts'

const now = new Date('2026-10-16T12:00:00Z')

function database(): Database {
  return {
    branding: { headline: '测试', badge: '', showBadge: false },
    departments: [], employees: [], models: [], skills: [], connectors: [], experts: [],
    backups: [], versionPackages: [], operationLogs: [], recentActivities: [], notifications: [], systemErrors: [],
    personalSkillReports: [], personalExperts: [], connectorAccounts: [], modelUsage: [], employeeVersionReports: [], dashboardTrend: [], systemMetric: {},
  }
}

function usage(id: string, createdAt: string, employeeId: string, totalTokens: unknown, status = 'completed'): RecordItem {
  return { id, createdAt, employeeId, totalTokens, status }
}

test('使用趋势按七个 UTC 自然日汇总，按日去重并区分缺失 Token', () => {
  const db = database()
  db.modelUsage = [
    usage('old', '2026-10-09T23:59:59Z', 'e1', 999),
    usage('first', '2026-10-10T00:00:00Z', 'e1', 100),
    usage('offset', '2026-10-16T01:00:00+08:00', 'e1', 200),
    usage('today1', '2026-10-16T00:00:00Z', 'e1', 1200),
    usage('today2', '2026-10-16T01:00:00Z', 'e1', 0, 'failed'),
    usage('today3', '2026-10-16T02:00:00Z', 'e2', null, 'pending'),
    usage('future', '2026-10-16T13:00:00Z', 'e3', 999),
  ]
  const result = dashboardData(db, now)
  assert.deepEqual(result, JSON.parse(readFileSync(new URL('./expected/dashboard.json', import.meta.url), 'utf8')))
  assert.deepEqual(db.dashboardTrend, [])
  for (const tokens of [undefined, -1, NaN, Infinity, 1.5, '10']) {
    db.modelUsage = [usage('missing', now.toISOString(), 'e1', tokens)]
    assert.equal(dashboardData(db, now).dashboardTrend[6]?.missingTokenCalls, 1)
  }
})

test('本月费用仅在每条记录均可计价且币种一致时汇总', () => {
  const db = database()
  db.modelUsage = [
    { ...usage('one', '2026-10-15T00:00:00Z', 'e1', 5), costStatus: 'calculated', cost: 1.25, currency: 'CNY' },
    { ...usage('two', '2026-10-16T00:00:00Z', 'e1', 5), costStatus: 'calculated', cost: 2.5, currency: 'CNY' },
  ]
  assert.deepEqual(dashboardData(db, now).monthlyCost, { status: 'calculated', amount: 3.75, currency: 'CNY' })
  db.modelUsage.push({ ...usage('missing', '2026-10-16T01:00:00Z', 'e1', null), costStatus: 'unavailable', cost: null })
  assert.deepEqual(dashboardData(db, now).monthlyCost, { status: 'partial' })
  db.modelUsage.pop()
  db.modelUsage[1]!.currency = 'USD'
  assert.deepEqual(dashboardData(db, now).monthlyCost, { status: 'multiple' })
})

test('动态按时间倒序取二十条，解析资源名称且不返回密钥字段', () => {
  const db = database()
  db.models = [{ id: 'm1', name: '企业模型', apiKey: 'secret' }]
  db.operationLogs = Array.from({ length: 21 }, (_, index) => ({
    id: String(index), time: `2026-10-16T00:${String(index).padStart(2, '0')}:00Z`,
    type: 'update:models', object: 'm1', change: '更新记录', apiKey: 'secret',
  }))
  const result = dashboardData(db, now)
  assert.equal(result.recentActivities.length, 20)
  assert.deepEqual(result.recentActivities[0], {
    id: '20', time: '2026-10-16T00:20:00Z', type: 'models', message: '已修改模型「企业模型」：历史记录未保存修改明细',
  })
  assert.equal(result.recentActivities.at(-1)?.id, '1')
  assert.equal(JSON.stringify(result).includes('secret'), false)
  db.models = []
  assert.equal(dashboardData(db, now).recentActivities[0]?.message, '已修改模型（名称未记录，编号：m1）：历史记录未保存修改明细')
})

test('总览拒绝格式错误的持久化记录，不将读取失败当作无数据', () => {
  const db = database()
  for (const invalid of [{ createdAt: 'bad', employeeId: 'e1' }, { createdAt: now.toISOString(), employeeId: null }]) {
    db.modelUsage = [{ id: 'invalid', ...invalid }]
    assert.throws(() => dashboardData(db, now), { code: 'DATA_INVALID' })
  }
  db.modelUsage = []
  for (const invalid of [{ time: 'bad' }, { time: now.toISOString(), change: null }]) {
    db.operationLogs = [{ id: 'invalid', type: 'update:models', object: 'm1', change: '更新', ...invalid }]
    assert.throws(() => dashboardData(db, now), { code: 'DATA_INVALID' })
  }
})

test('删除资源后动态保留名称与具体修改项，旧记录明确标注缺失信息', () => {
  const db = database()
  const before = { id: 's1', name: '销售助手', enabled: true, scope: 'all' }
  const after = { ...before, enabled: false, scope: 'department' }
  db.operationLogs = [
    { id: '1', time: '2026-10-16T01:00:00Z', type: 'create:skills', object: 's1', change: resourceOperationSummary('skills', 'create', before) },
    { id: '2', time: '2026-10-16T02:00:00Z', type: 'update:skills', object: 's1', change: resourceOperationSummary('skills', 'update', after, before) },
    { id: '3', time: '2026-10-16T03:00:00Z', type: 'delete:skills', object: 's1', change: resourceOperationSummary('skills', 'delete', after) },
    { id: '4', time: '2026-10-16T04:00:00Z', type: 'delete:skills', object: 'legacy-skill', change: '删除记录' },
  ]
  assert.deepEqual(dashboardData(db, now).recentActivities,
    JSON.parse(readFileSync(new URL('./expected/operation-activities.json', import.meta.url), 'utf8')))
})
