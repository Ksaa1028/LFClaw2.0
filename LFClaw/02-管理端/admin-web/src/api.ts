import type { AppAction, AppState } from './store.ts'

const API = import.meta.env.VITE_LFCLAW_API_URL ?? '/lfclaw/api'
let sessionToken = sessionStorage.getItem('lfclaw-admin-token') ?? ''

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function hasSession(): boolean { return sessionToken !== '' }
export function clearSession(): void {
  sessionToken = ''
  sessionStorage.removeItem('lfclaw-admin-token')
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message : `请求失败（HTTP ${response.status}）`
    if (response.status === 401) clearSession()
    throw new ApiError(response.status, message)
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

export async function login(username: string, password: string): Promise<void> {
  const result = await request<{ token: string }>('/admin/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  })
  sessionToken = result.token
  sessionStorage.setItem('lfclaw-admin-token', sessionToken)
}

export async function logout(): Promise<void> {
  try { await request<void>('/logout', { method: 'POST' }) } finally { clearSession() }
}

export async function changeAdminPassword(currentPassword: string, nextPassword: string): Promise<void> {
  const result = await request<{ token: string }>('/admin/password', {
    method: 'POST', body: JSON.stringify({ currentPassword, nextPassword }),
  })
  sessionToken = result.token
  sessionStorage.setItem('lfclaw-admin-token', sessionToken)
}

export function loadData(signal?: AbortSignal): Promise<AppState> { return request<AppState>('/admin/data', signal ? { signal } : {}) }
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
export function loadUsageReport(filters: { from: string; to: string; employeeId: string; modelId: string }, signal?: AbortSignal): Promise<UsageReport> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  return request<UsageReport>(`/admin/usage${query.size ? `?${query}` : ''}`, signal ? { signal } : {})
}
export function loadSystemStatus(): Promise<AppState['systemMetric']> { return request('/admin/status') }

export interface EffectiveResource {
  collection: 'models' | 'skills' | 'connectors' | 'experts'
  expertKind?: 'expert' | 'team'
  id: string
  name: string
  allowed: boolean
  source: string
  override: 'allow' | 'deny' | 'inherit'
}

export async function loadEmployeePermissions(employeeId: string): Promise<EffectiveResource[]> {
  const result = await request<{ resources: EffectiveResource[] }>(`/admin/employees/${encodeURIComponent(employeeId)}/effective`)
  return result.resources
}

export function setEmployeePermission(employeeId: string, resource: EffectiveResource,
  decision: 'allow' | 'deny' | 'inherit'): Promise<void> {
  return request(`/admin/permissions/${resource.collection}/${encodeURIComponent(resource.id)}/${encodeURIComponent(employeeId)}`,
    { method: 'PUT', body: JSON.stringify({ decision }) })
}

export const MALL_MCP_PERMISSIONS = [
  'operation.floor.1', 'operation.floor.2', 'operation.floor.3',
  'operation.floor.4', 'operation.self_operated',
] as const
export type MallMcpPermission = typeof MALL_MCP_PERMISSIONS[number]
export interface EmployeeMcpPermissions {
  employeeId: string
  permissions: MallMcpPermission[]
}

export function loadEmployeeMcpPermissions(employeeId: string): Promise<EmployeeMcpPermissions> {
  return request(`/admin/employees/${encodeURIComponent(employeeId)}/mcp-permissions`)
}

export function saveEmployeeMcpPermissions(employeeId: string,
  permissions: MallMcpPermission[]): Promise<EmployeeMcpPermissions> {
  return request(`/admin/employees/${encodeURIComponent(employeeId)}/mcp-permissions`,
    { method: 'PUT', body: JSON.stringify({ permissions }) })
}

type StoredAction = Exclude<AppAction['type'], `SET_${string}` | 'ADD_ACTIVITY' | 'ADD_OPERATION_LOG' | 'HYDRATE' | 'REVOKE_NOTIFICATION' | 'DELETE_NOTIFICATION'>
const routes: Record<StoredAction, string> = {
  ADD_DEPARTMENT: 'departments', UPDATE_DEPARTMENT: 'departments', DELETE_DEPARTMENT: 'departments',
  ADD_EMPLOYEE: 'employees', UPDATE_EMPLOYEE: 'employees', DELETE_EMPLOYEE: 'employees',
  ADD_MODEL: 'models', UPDATE_MODEL: 'models', DELETE_MODEL: 'models',
  ADD_SKILL: 'skills', UPDATE_SKILL: 'skills', DELETE_SKILL: 'skills',
  ADD_CONNECTOR: 'connectors', UPDATE_CONNECTOR: 'connectors', DELETE_CONNECTOR: 'connectors',
  ADD_EXPERT: 'experts', UPDATE_EXPERT: 'experts', DELETE_EXPERT: 'experts',
  ADD_BACKUP: 'backups', ADD_VERSION: 'versionPackages', ADD_NOTIFICATION: 'notifications',
}

export async function saveAction(action: AppAction): Promise<AppAction> {
  if (action.type === 'HYDRATE' || action.type.startsWith('SET_') || action.type === 'ADD_ACTIVITY' || action.type === 'ADD_OPERATION_LOG') return action
  if (action.type === 'ADD_NOTIFICATION') {
    const saved = await request<typeof action.payload>('/admin/notifications', { method: 'POST', body: JSON.stringify(action.payload) })
    return { type: 'ADD_NOTIFICATION', payload: saved }
  }
  if (action.type === 'REVOKE_NOTIFICATION') {
    const saved = await request<typeof action.payload>(`/admin/notifications/${encodeURIComponent(action.payload.id)}/revoke`, { method: 'POST' })
    return { type: 'REVOKE_NOTIFICATION', payload: saved }
  }
  if (action.type === 'DELETE_NOTIFICATION') {
    await request<void>(`/admin/notifications/${encodeURIComponent(action.payload)}`, { method: 'DELETE' })
    return action
  }
  if (action.type === 'ADD_BACKUP') {
    const saved = await request<typeof action.payload>('/admin/backups', { method: 'POST' })
    return { type: 'ADD_BACKUP', payload: saved }
  }
  if (action.type === 'ADD_VERSION') throw new ApiError(501, '版本发布尚未接入真实服务')
  const route = routes[action.type as StoredAction]
  const method = action.type.startsWith('ADD_') ? 'POST' : action.type.startsWith('UPDATE_') ? 'PUT' : 'DELETE'
  const id = typeof action.payload === 'string' ? action.payload : 'id' in action.payload ? action.payload.id : ''
  const suffix = method === 'POST' ? '' : `/${encodeURIComponent(id)}`
  const saved = await request<typeof action.payload>(`/admin/data/${route}${suffix}`, {
    method,
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(action.payload) }),
  })
  return method === 'DELETE' ? action : { ...action, payload: saved } as AppAction
}

export async function resetActivationCode(employeeId: string): Promise<string> {
  const result = await request<{ activationCode: string }>(`/admin/employees/${encodeURIComponent(employeeId)}/reset-code`, { method: 'POST' })
  return result.activationCode
}

export async function uploadSkill(file: File): Promise<{ path: string; description: string }> {
  const data = new FormData()
  data.append('file', file)
  return request<{ path: string; description: string }>('/admin/skills/upload', { method: 'POST', body: data })
}

export interface SkillVersion {
  revision: number
  version: string
  sha256: string
  description: string
  createdAt: string
  restoredFromRevision?: number
}

export interface SkillVersions {
  skillId: string
  currentRevision: number
  versions: SkillVersion[]
}

export function loadSkillVersions(id: string): Promise<SkillVersions> {
  return request(`/admin/skills/${encodeURIComponent(id)}/versions`)
}

export function rollbackSkill(id: string, revision: number): Promise<void> {
  return request(`/admin/skills/${encodeURIComponent(id)}/rollback`,
    { method: 'POST', body: JSON.stringify({ revision }) })
}

export async function testModel(id: string): Promise<{ latencyMs: number }> {
  return request<{ latencyMs: number }>(`/admin/models/${encodeURIComponent(id)}/test`, { method: 'POST' })
}

export function testConnector(id: string): Promise<{ tools: Array<{ name: string; description?: string }>; verified: boolean }> {
  return request(`/admin/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' })
}

export function testExpert(id: string): Promise<{ ok: boolean; text: string }> {
  return request(`/admin/experts/${encodeURIComponent(id)}/test`, { method: 'POST' })
}

export async function downloadBackup(id: string): Promise<void> {
  const response = await fetch(`${API}/admin/backups/${encodeURIComponent(id)}/download`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  if (!response.ok) throw new ApiError(response.status, `备份下载失败（HTTP ${response.status}）`)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `lfclaw-backup-${id}.zip`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function restoreSavedBackup(id: string): Promise<void> {
  return request<void>(`/admin/backups/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

export function deleteBackup(id: string): Promise<void> {
  return request<void>(`/admin/backups/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createManualBackup(): Promise<import('./mock/data.ts').BackupRecord> {
  return request('/admin/backups', { method: 'POST' })
}

export async function restoreUploadedBackup(file: File): Promise<void> {
  const data = new FormData()
  data.append('file', file)
  return request<void>('/admin/backups/restore', { method: 'POST', body: data })
}
