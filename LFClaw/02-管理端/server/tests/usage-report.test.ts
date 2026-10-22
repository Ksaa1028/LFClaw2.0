import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUsageReportQuery, usageReport } from '../src/usage-report.ts'
import type { Database } from '../src/store.ts'

function database(): Database {
  return {
    branding: { headline: '测试', badge: '', showBadge: false },
    departments: [], employees: [{ id: 'e1', name: '员工甲' }, { id: 'e2', name: '员工乙' }],
    models: [{ id: 'm1', name: '模型甲' }, { id: 'm2', name: '模型乙' }],
    skills: [], connectors: [], experts: [], backups: [], versionPackages: [], operationLogs: [],
    recentActivities: [], notifications: [], systemErrors: [], personalSkillReports: [], personalExperts: [],
    connectorAccounts: [], modelUsage: [], employeeVersionReports: [], dashboardTrend: [], systemMetric: {},
  }
}

test('按账号和模型汇总已知 Token，缺失字段单独计数，并保留已删除资源的 ID', () => {
  const db = database()
  db.modelUsage = [
    { id: '1', createdAt: '2026-10-20T23:30:00Z', employeeId: 'e1', modelId: 'm1', inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    { id: '2', createdAt: '2026-10-21T00:30:00Z', employeeId: 'e1', modelId: 'm2', inputTokens: 7, outputTokens: null, totalTokens: null },
    { id: '3', createdAt: '2026-10-21T01:00:00Z', employeeId: 'e2', modelId: 'deleted', inputTokens: 4, outputTokens: 1, totalTokens: 5 },
  ]
  const report = usageReport(db, { from: '2026-10-21' })
  assert.deepEqual(report.total, { calls: 2, inputTokens: 11, outputTokens: 1, totalTokens: 5, missingTokenCalls: 1 })
  assert.deepEqual(report.employees.map(row => [row.name, row.calls, row.totalTokens]), [['员工乙', 1, 5], ['员工甲', 1, 0]])
  assert.equal(report.models.find(row => row.id === 'deleted')?.name, 'deleted')
  assert.deepEqual(usageReport(db, { employeeId: 'e1', modelId: 'm1' }).total,
    { calls: 1, inputTokens: 3, outputTokens: 2, totalTokens: 5, missingTokenCalls: 0 })
})

test('日期筛选只接受真实 UTC 日期和正向区间', () => {
  assert.deepEqual(parseUsageReportQuery({ from: '2026-10-20', to: '2026-10-21' }), { from: '2026-10-20', to: '2026-10-21' })
  for (const query of [{ from: '2026-02-30' }, { to: 'bad' }, { from: '2026-10-22', to: '2026-10-21' }, { employeeId: ['e1'] }]) {
    assert.equal(parseUsageReportQuery(query), null)
  }
})

test('损坏的用量标识阻止报表生成', () => {
  const db = database()
  db.modelUsage = [{ id: 'invalid', employeeId: 'e1', createdAt: '2026-10-21T00:00:00Z' }]
  assert.throws(() => usageReport(db, {}), { code: 'DATA_INVALID' })
})
