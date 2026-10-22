import { StoreError, type Database, type RecordItem } from './store.ts'

export interface UsageReportQuery {
  from?: string
  to?: string
  employeeId?: string
  modelId?: string
}

export interface UsageSummaryRow {
  id: string
  name: string
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  missingTokenCalls: number
}

export interface UsageReport {
  employees: UsageSummaryRow[]
  models: UsageSummaryRow[]
  total: Omit<UsageSummaryRow, 'id' | 'name'>
}

/** Parse an inclusive UTC date filter from an administrator query. */
export function parseUsageReportQuery(query: Record<string, unknown>): UsageReportQuery | null {
  const result: UsageReportQuery = {}
  for (const field of ['from', 'to'] as const) {
    const value = query[field]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
      || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) return null
    result[field] = value
  }
  if (result.from && result.to && result.from > result.to) return null
  for (const field of ['employeeId', 'modelId'] as const) {
    const value = query[field]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || value.length > 200) return null
    result[field] = value
  }
  return result
}

function emptyTotals() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, missingTokenCalls: 0 }
}

function validTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function addUsage(target: ReturnType<typeof emptyTotals>, usage: RecordItem): void {
  target.calls++
  if (validTokens(usage.inputTokens)) target.inputTokens += usage.inputTokens
  if (validTokens(usage.outputTokens)) target.outputTokens += usage.outputTokens
  if (validTokens(usage.totalTokens)) target.totalTokens += usage.totalTokens
  if (!validTokens(usage.inputTokens) || !validTokens(usage.outputTokens) || !validTokens(usage.totalTokens)) target.missingTokenCalls++
}

/** Aggregate saved gateway calls by employee and model without returning request content. */
export function usageReport(db: Database, query: UsageReportQuery): UsageReport {
  const employees = new Map<string, ReturnType<typeof emptyTotals>>()
  const models = new Map<string, ReturnType<typeof emptyTotals>>()
  const total = emptyTotals()
  for (const usage of db.modelUsage) {
    if (typeof usage.employeeId !== 'string' || !usage.employeeId
      || typeof usage.modelId !== 'string' || !usage.modelId
      || typeof usage.createdAt !== 'string' || !Number.isFinite(Date.parse(usage.createdAt))) {
      throw new StoreError('DATA_INVALID', '模型用量记录无效，无法生成用量报表')
    }
    const date = new Date(usage.createdAt).toISOString().slice(0, 10)
    if (query.from && date < query.from || query.to && date > query.to
      || query.employeeId && usage.employeeId !== query.employeeId
      || query.modelId && usage.modelId !== query.modelId) continue
    const employee = employees.get(usage.employeeId) ?? emptyTotals()
    const model = models.get(usage.modelId) ?? emptyTotals()
    addUsage(employee, usage)
    addUsage(model, usage)
    addUsage(total, usage)
    employees.set(usage.employeeId, employee)
    models.set(usage.modelId, model)
  }
  const names = (items: RecordItem[]) => new Map(items.map(item => [item.id, typeof item.name === 'string' && item.name ? item.name : item.id]))
  const employeeNames = names(db.employees)
  const modelNames = names(db.models)
  const rows = (totals: Map<string, ReturnType<typeof emptyTotals>>, labels: Map<string, string>): UsageSummaryRow[] =>
    [...totals].map(([id, values]) => ({ id, name: labels.get(id) ?? id, ...values }))
      .sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name))
  return { employees: rows(employees, employeeNames), models: rows(models, modelNames), total }
}
