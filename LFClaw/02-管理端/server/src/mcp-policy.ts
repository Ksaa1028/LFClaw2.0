/** 企业网关限制商场查询参数；未审计工具只向完整权限员工开放。 */
import { mallPermissionIds, permissionsForEmployee, usesMallDataPermissions } from './mcp.ts'
import { authorizationFor } from './authorization.ts'
import type { Database, RecordItem } from './store.ts'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const scopedTools = new Set(['getFloorDimensionData', 'getRegionDimensionData', 'getShopDimensionData'])
const floorIds = ['1', '2', '3', '4', '565']
const identityFields = new Set(['openId', 'appId', 'appSecret'])
const floorNames = ['一层', '二层', '三层', '四层', '自营']

/**
 * 按实际查询覆盖范围判断工具是否可用；工具开关仍需单独校验。
 * @param name - 上游工具名。
 * @param permissions - 服务端计算的有效楼层权限。
 * @returns 是否覆盖该工具可能返回的数据范围。
 */
export function mallToolAllowed(name: string, permissions: readonly string[]): boolean {
  return permissions.length > 0 && (scopedTools.has(name)
    || mallPermissionIds.every(permission => permissions.includes(permission)))
}

/**
 * 校验显式楼层参数，混合越权请求整体拒绝，不自动改变查询范围。
 * @param name - 上游工具名。
 * @param args - 员工请求参数。
 * @param permissions - 服务端计算的有效楼层权限。
 * @returns 是否允许请求的工具与楼层范围。
 */
export function mallArgumentsAllowed(name: string, args: Record<string, unknown>, permissions: readonly string[]): boolean {
  if (!mallToolAllowed(name, permissions)) return false
  if (!scopedTools.has(name)) return true
  const allowed = new Set(mallPermissionIds.flatMap((permission, index) => permissions.includes(permission) ? [floorIds[index]!] : []))
  if (args.floorId !== undefined && args.floorId !== null
    && (typeof args.floorId !== 'number' || !Number.isInteger(args.floorId) || !allowed.has(String(args.floorId)))) return false
  if (name === 'getRegionDimensionData' && typeof args.floorIds !== 'string') return false
  if (name === 'getShopDimensionData' && args.regionId != null && args.floorId == null) return false
  if (args.floorIds !== undefined) {
    if (typeof args.floorIds !== 'string' || !args.floorIds.trim()) return false
    return args.floorIds.split(',').every(item => {
      const value = item.trim()
      if (name === 'getRegionDimensionData') return /^(?:[1-4]-[1-3]|565)$/.test(value) && allowed.has(value.split('-')[0]!)
      return allowed.has(value)
    })
  }
  return true
}

/**
 * 将有效的多楼层请求收窄到员工授权交集；无交集或无效参数仍由调用入口拒绝。
 * @param name - 上游工具名。
 * @param args - 员工请求参数。
 * @param permissions - 当前有效楼层权限。
 * @returns 查询参数及本次未授权楼层名称，不向 MCP 发送被排除楼层。
 */
export function restrictMallQuery(name: string, args: Record<string, unknown>, permissions: readonly string[]): {
  arguments: Record<string, unknown>; unavailableFloors: string[]
} {
  if (!['getFloorDimensionData', 'getRegionDimensionData'].includes(name) || typeof args.floorIds !== 'string'
    || !mallArgumentsAllowed(name, args, mallPermissionIds)) return { arguments: args, unavailableFloors: [] }
  const allowed = new Set(mallPermissionIds.flatMap((permission, index) => permissions.includes(permission) ? [floorIds[index]!] : []))
  const requested = [...new Set(args.floorIds.split(',').map(value => value.trim()))]
  const included = requested.filter(value => allowed.has(value.split('-')[0]!))
  if (!included.length) return { arguments: args, unavailableFloors: [] }
  const excluded = [...new Set(requested.filter(value => !allowed.has(value.split('-')[0]!)).map(value => value.split('-')[0]!))]
  return { arguments: { ...args, floorIds: included.join(',') },
    unavailableFloors: excluded.map(floor => floorNames[floorIds.indexOf(floor)]!) }
}

/**
 * 解析已校验请求。部分权限按单楼层调用，防止上游附带全场汇总；不使用 Java 签名分支。
 * @param name - 已授权工具名。
 * @param args - 已通过 mallArgumentsAllowed 的参数。
 * @param permissions - 当前有效楼层权限。
 * @returns 覆盖身份参数并明确查询范围的上游调用参数列表。
 */
export function resolveMallCalls(name: string, args: Record<string, unknown>, permissions: readonly string[]): Record<string, unknown>[] {
  const safe: Record<string, unknown> = { ...args, openId: '', appId: '', appSecret: '' }
  const floors = mallPermissionIds.flatMap((permission, index) => permissions.includes(permission) ? [floorIds[index]!] : [])
  if (name === 'getFloorDimensionData' && args.floorIds === undefined) safe.floorIds = floors.join(',')
  if (floors.length === mallPermissionIds.length) return [safe]
  if (name === 'getShopDimensionData') return (args.floorId == null ? floors : [String(args.floorId)])
    .map(floor => ({ ...safe, floorId: Number(floor) }))
  if (name === 'getFloorDimensionData') return [...new Set(String(safe.floorIds).split(',').map(value => value.trim()))]
    .map(floor => ({ ...safe, floorIds: floor }))
  const groups = new Map<string, string[]>()
  for (const region of String(args.floorIds).split(',').map(value => value.trim())) {
    const floor = region.split('-')[0]!
    groups.set(floor, [...(groups.get(floor) ?? []), region])
  }
  return [...groups.values()].map(regions => ({ ...safe, floorIds: [...new Set(regions)].join(',') }))
}

/**
 * 将已审计查询的成功响应权限提示改为员工实际范围，业务数据及错误保持原值。
 * @param name - 上游工具名。
 * @param result - 已通过 MCP 响应校验的结果。
 * @param permissions - 此次调用的有效权限。
 * @returns 使用员工权限说明的 MCP 结果。
 */
export function mallPublicResult(name: string, result: CallToolResult, permissions: readonly string[]): CallToolResult {
  if (!scopedTools.has(name) || result.isError) return result
  const names = mallPermissionIds.flatMap((permission, index) => permissions.includes(permission) ? [floorNames[index]!] : [])
  const normalize = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('success' in value) || value.success !== true
      || !('data' in value) || !('info' in value) || typeof value.info !== 'string') return value
    return { ...value, info: `当前商场数据权限：${names.join('、') || '无'}。` }
  }
  return { ...result, content: result.content.map(item => {
    if (item.type !== 'text') return item
    let value: unknown
    try { value = JSON.parse(item.text) }
    catch (error) { if (error instanceof SyntaxError) return item; throw error }
    const normalized = normalize(value)
    return normalized === value ? item : { ...item, text: JSON.stringify(normalized) }
  }), ...(result.structuredContent ? { structuredContent: normalize(result.structuredContent) as Record<string, unknown> } : {}) }
}

/**
 * 移除员工身份字段并声明当前范围；查询范围由企业网关强制限定。
 * @param tool - MCP 返回的工具定义。
 * @param permissions - 当前有效楼层权限。
 * @returns 可提供给员工与模型的工具定义。
 */
export function mallPublicSchema<T extends { description?: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }>(tool: T, permissions: readonly string[]): T {
  const names = mallPermissionIds.flatMap((permission, index) => permissions.includes(permission) ? [floorNames[index]!] : [])
  const ids = mallPermissionIds.flatMap((permission, index) => permissions.includes(permission) ? [floorIds[index]!] : [])
  return { ...tool, description: `${tool.description ?? ''}\n当前商场数据权限：${names.join('、') || '无'}（楼层 ID：${ids.join(',') || '无'}）。用户请求各楼层或全场时，直接查询已授权范围，并说明其余楼层未授权、无法获取；不要要求用户先扩权、选择方案或新建会话。每次查询以当前授权为准。`, inputSchema: { ...tool.inputSchema,
    properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).filter(([name]) => !identityFields.has(name))),
    ...(tool.inputSchema.required ? { required: tool.inputSchema.required.filter(name => !identityFields.has(name)) } : {}) } }
}

/**
 * 员工目录和调用入口共用的可调用工具清单。
 * @param connector - 服务端连接器配置。
 * @param permissions - 当前有效楼层权限。
 * @returns 通过配置与数据范围校验的工具。
 */
export function connectorTools(connector: RecordItem, permissions: readonly string[]): Record<string, unknown>[] {
  return Array.isArray(connector.tools) ? connector.tools.filter((tool): tool is Record<string, unknown> =>
    !!tool && typeof tool === 'object' && !Array.isArray(tool) && typeof tool.name === 'string'
    && (!usesMallDataPermissions(connector) || tool.allowed === true && mallToolAllowed(tool.name, permissions))) : []
}

/**
 * 返回员工当前连接器与楼层范围，不包含连接地址、凭据或签名。
 * @param db - 当前数据库快照。
 * @param employee - 已认证员工。
 * @returns 仅包含该员工获授权资源的目录。
 */
export function employeeConnectors(db: Database, employee: RecordItem) {
  const permissions = permissionsForEmployee(db, employee)
  return db.connectors.filter(connector => authorizationFor(connector, employee, db).allowed).map(connector => ({
    id: connector.id, name: connector.name, type: connector.type,
    icon: typeof connector.icon === 'string' ? connector.icon : '',
    showToolsInClient: (connector.showToolsInClient ?? connector.showInClient) !== false,
    permissionSource: authorizationFor(connector, employee, db).source,
    ...(usesMallDataPermissions(connector) ? { dataPermissions: permissions } : {}),
    ...accountSummary(db, connector, employee.id),
    tools: accountSummary(db, connector, employee.id).account?.configured === false ? []
      : connectorTools(connector, permissions).map(tool => ({ id: tool.id, name: tool.name, description: tool.description })),
  }))
}
import { accountSummary } from './connector-account.ts'
