/** 从已保存的模型用量与管理员操作日志生成总览，不读取员工会话正文。 */
import { StoreError, type Database } from './store.ts'
import { operationActivity } from './operation-summary.ts'

/** 汇总最近七个 UTC 自然日及最近二十条管理员操作。
 * @param db 已读取的企业数据。
 * @param now 统计截止时间。
 * @returns 总览图表与动态；缺失 Token 的调用单独计数，非法记录拒绝统计。
 */
export function dashboardData(db: Database, now = new Date()) {
  const end = now.getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: new Date(today - (6 - index) * 86_400_000).toISOString().slice(0, 10),
    conversations: 0, tokens: 0, missingTokenCalls: 0, employees: new Set<string>(),
  }))
  const byDate = new Map(days.map(day => [day.date, day]))
  const month = now.toISOString().slice(0, 7)
  let monthlyCalls = 0
  let pricedCalls = 0
  let monthlyAmount = 0
  const currencies = new Set<string>()
  for (const usage of db.modelUsage) {
    if (typeof usage.createdAt !== 'string' || !Number.isFinite(Date.parse(usage.createdAt))
      || typeof usage.employeeId !== 'string' || !usage.employeeId) {
      throw new StoreError('DATA_INVALID', '模型用量的时间或员工标识无效，无法生成使用趋势')
    }
    const time = Date.parse(usage.createdAt)
    if (time > end) continue
    if (new Date(time).toISOString().startsWith(month)) {
      monthlyCalls++
      if (usage.costStatus === 'calculated' && typeof usage.cost === 'number' && Number.isFinite(usage.cost)
        && typeof usage.currency === 'string' && usage.currency) {
        pricedCalls++
        monthlyAmount += usage.cost
        currencies.add(usage.currency)
      }
    }
    const day = byDate.get(new Date(time).toISOString().slice(0, 10))
    if (!day) continue
    day.conversations++
    day.employees.add(usage.employeeId)
    if (typeof usage.totalTokens === 'number' && Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= 0) {
      day.tokens += usage.totalTokens
    } else day.missingTokenCalls++
  }
  const recentActivities = db.operationLogs.map(log => {
    if (typeof log.time !== 'string' || !Number.isFinite(Date.parse(log.time))
      || typeof log.type !== 'string' || typeof log.object !== 'string' || typeof log.change !== 'string') {
      throw new StoreError('DATA_INVALID', '管理员操作日志格式无效，无法生成最新动态')
    }
    return { id: log.id, time: log.time, ...operationActivity(log, db) }
  }).sort((left, right) => Date.parse(right.time) - Date.parse(left.time)).slice(0, 20)
  return {
    dashboardTrend: days.map(({ employees, ...day }) => ({ ...day, activeEmployees: employees.size })),
    recentActivities,
    monthlyCost: monthlyCalls === 0 || pricedCalls === 0 ? { status: 'unavailable' }
      : pricedCalls !== monthlyCalls ? { status: 'partial' }
        : currencies.size !== 1 ? { status: 'multiple' }
          : { status: 'calculated', amount: monthlyAmount, currency: [...currencies][0]! },
  }
}
