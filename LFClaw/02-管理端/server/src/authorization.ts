/** 企业资源的部门继承与员工覆盖，供接口授权和来源展示共用。 */
import type { Database, RecordItem } from './store.ts'

/** 资源对指定员工的当前授权结果及来源。 */
export interface Authorization { allowed: boolean; source: string }

/** 按停用、个人覆盖、资源范围和部门祖先顺序计算授权。
 * @param item 企业资源。
 * @param employee 当前员工。
 * @param db 部门层级所在数据库。
 * @returns 授权结果与来源。
 */
export function authorizationFor(item: RecordItem, employee: RecordItem, db: Database): Authorization {
  if (item.enabled === false) return { allowed: false, source: 'disabled' }
  if (item.scope === 'none') return { allowed: false, source: 'none' }
  const overrides = item.employeeOverrides
  const decision = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    ? (overrides as Record<string, unknown>)[employee.id] : undefined
  if (decision === 'deny') return { allowed: false, source: 'employee-deny' }
  if (decision === 'allow') return { allowed: true, source: 'employee-allow' }
  if (item.scope === 'all') return { allowed: true, source: 'all' }
  const targets = Array.isArray(item.scopeTarget) ? item.scopeTarget : []
  if (item.scope === 'employee') return targets.includes(employee.id)
    ? { allowed: true, source: 'employee' } : { allowed: false, source: 'none' }
  if (item.scope === 'department') {
    const seen = new Set<string>()
    let departmentId = typeof employee.departmentId === 'string' ? employee.departmentId : ''
    while (departmentId && !seen.has(departmentId)) {
      if (targets.includes(departmentId)) return { allowed: true, source: `department:${departmentId}` }
      seen.add(departmentId)
      const department = db.departments.find(value => value.id === departmentId)
      departmentId = typeof department?.parentId === 'string' ? department.parentId : ''
    }
  }
  return { allowed: false, source: 'none' }
}
