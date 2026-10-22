/** 渲染层可见的员工资料，不包含激活码或令牌。 */
export interface EmployeeProfile { name: string; departmentName: string | null }
/** 校验 Host 返回的员工展示字段。
 * @param value - 接口响应。
 * @returns 员工展示资料或空值。
 */
export function employeeProfile(value: unknown): EmployeeProfile | null {
  if (!value || typeof value !== 'object' || !('activated' in value) || value.activated !== true || !('employee' in value)) return null
  const employee = value.employee
  if (!employee || typeof employee !== 'object' || !('name' in employee) || typeof employee.name !== 'string') return null
  return { name: employee.name, departmentName: 'departmentName' in employee && typeof employee.departmentName === 'string' ? employee.departmentName : null }
}
