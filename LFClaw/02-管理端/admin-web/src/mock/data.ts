export interface Department {
  id: string
  name: string
  code: string
  parentId: string | null
}

export interface Employee {
  id: string
  name: string
  email: string
  departmentId: string
  status: 'active' | 'inactive'
  activationCode: string
}

export interface Model {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  upstreamModelId?: string
  enableThinking?: boolean | null
  pricePerMillionInput?: number | null
  pricePerMillionOutput?: number | null
  currency?: string
  type: string
  protocol: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  isDefault: boolean
  scope: 'all' | 'department' | 'employee' | 'none'
  scopeTarget: string[]
  monthlyCost?: number
}

export interface Skill {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  source: 'enterprise' | 'personal'
  parsingStatus: 'pending' | 'success' | 'failed'
  scope: 'all' | 'department' | 'employee' | 'none'
  scopeTarget: string[]
    zipPath?: string
    icon?: string
  }

export interface ConnectorTool {
  id: string
  name: string
  description: string
  allowed: boolean
}

export interface ConnectorAuthentication {
  type: 'none' | 'token' | 'fields' | 'oauth'
  owner: 'enterprise' | 'employee'
  fields: { key: string; label: string; target: 'header' | 'env'; name: string; prefix: string; required: boolean; secret: boolean }[]
  clientId?: string
  issuer?: string
  scopes?: string
}
export interface Connector {
  authentication?: ConnectorAuthentication
  account?: { configured: boolean; status: string; configuration: string }
  id: string
  name: string
  type: string
  endpoint?: string
  transport?: 'sse' | 'streamable-http' | 'stdio'
  command?: string
  args?: string[]
  env?: Record<string, string>
  employeeCredentials?: 'shared' | 'wechat-mp'
  mallDataPermissions?: boolean
  headers?: Record<string, string>
  icon?: string
  enabled: boolean
  showToolsInClient?: boolean
  showInClient?: boolean
  tools: ConnectorTool[]
  scope: 'all' | 'department' | 'employee' | 'none'
  scopeTarget: string[]
    zipPath?: string
  }

export interface Expert {
  skillIds?: string[]
  connectorIds?: string[]
  quickPrompts?: string[]
  id: string
  name: string
  description: string
  instructions?: string
  enabled: boolean
  tags: string[]
  source: 'dsh' | 'bailian' | 'dify' | 'weknora' | 'external' | 'team'
  memberIds?: string[]
  externalConfig?: {
    appId?: string
    workspaceId?: string
    agentId?: string
    apiUrl?: string
    apiKey: string
    inputs?: Record<string, unknown>
  } | undefined
  hasApiKey?: boolean
  scope: 'all' | 'department' | 'employee' | 'none'
  scopeTarget: string[]
    zipPath?: string
    icon?: string
  }

export interface BackupRecord {
  id: string
  name: string
  time: string
  createdAt: string
  type: 'manual' | 'auto'
  size: number
  sizeBytes: number
  status: 'success' | 'failed'
}

export interface VersionPackage {
  id: string
  version: string
  platform: 'windows' | 'macos'
  size: number
  sizeBytes: number
  releaseTime: string
  publishedAt: string
  forceUpdate: boolean
  enabled: boolean
  status: 'published' | 'draft'
  releaseNotes: string
}

export interface EmployeeVersionReport {
  employeeId: string
  employeeName: string
  version: string
  platform: 'windows' | 'macos'
  lastReportTime: string
  lastReportAt: string
  osVersion: string
  updateStatus: 'updated' | 'pending' | 'offline'
}

export interface OperationLog {
  id: string
  time: string
  type: string
  object: string
  change: string
  operator: string
}

export interface RecentError {
  id: string
  time: string
  service: string
  message: string
}

export interface SystemError {
  id: string
  time: string
  source: string
  message: string
}

export interface DashboardActivity {
  id: string
  time: string
  type:
    | 'operation'
    | 'departments' | 'employees' | 'models' | 'skills' | 'connectors' | 'experts'
    | 'backups' | 'notifications' | 'versions' | 'settings' | 'security' | 'permissions'
    | 'employeeAdded'
    | 'modelTested'
    | 'connectorUpdated'
    | 'skillPublished'
    | 'backupCreated'
    | 'versionReleased'
  message: string
}

export interface UsagePoint {
  date: string
  conversations: number
  tokens: number
  missingTokenCalls?: number
  activeEmployees: number
}

export interface Notification {
  id: string
  title: string
  content: string
  sentAt: string
  revokedAt?: string
}

export interface SystemMetric {
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
  gatewayStatus: 'online' | 'offline'
}

export const MOCK_DEPARTMENTS: Department[] = [
  { id: 'd-root', name: '商场总部', code: 'HQ', parentId: null },
  { id: 'd-1f', name: '一层营运部', code: '1F', parentId: 'd-root' },
  { id: 'd-2f', name: '二层营运部', code: '2F', parentId: 'd-root' },
  { id: 'd-3f', name: '三层营运部', code: '3F', parentId: 'd-root' },
  { id: 'd-4f', name: '四层营运部', code: '4F', parentId: 'd-root' },
  { id: 'd-self', name: '营运自营部', code: 'SELF', parentId: 'd-root' },
  { id: 'd-it', name: '信息技术部', code: 'IT', parentId: 'd-root' },
]

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 'e-1', name: '张 Tong', email: 'zhang.tong@lfclaw.local', departmentId: 'd-1f', status: 'active', activationCode: 'LF-ZHANGTONG-A1B2C3D4' },
  { id: 'e-2', name: '李 Kai', email: 'li.kai@lfclaw.local', departmentId: 'd-2f', status: 'active', activationCode: 'LF-LIKAI-E5F6G7H8' },
  { id: 'e-3', name: '王 Fang', email: 'wang.fang@lfclaw.local', departmentId: 'd-self', status: 'active', activationCode: 'LF-WANGFANG-I9J0K1L2' },
  { id: 'e-4', name: '赵 Qiang', email: 'zhao.qiang@lfclaw.local', departmentId: 'd-it', status: 'inactive', activationCode: 'LF-ZHAOQIANG-M3N4O5P6' },
  { id: 'e-5', name: '陈 Mei', email: 'chen.mei@lfclaw.local', departmentId: 'd-3f', status: 'active', activationCode: 'LF-CHENMEI-Q7R8S9T0' },
  { id: 'e-6', name: '刘 Wei', email: 'liu.wei@lfclaw.local', departmentId: 'd-4f', status: 'active', activationCode: 'LF-LIUWEI-U1V2W3X4' },
]

export const MOCK_MODELS: Model[] = [
  { id: 'm-1', name: 'DeepSeek-V3', type: 'text', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-***v3', enabled: true, isDefault: true, scope: 'all', scopeTarget: [], monthlyCost: 12450 },
  { id: 'm-2', name: 'DeepSeek-R1', type: 'reasoning', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-***r1', enabled: true, isDefault: false, scope: 'department', scopeTarget: ['d-it', 'd-self'], monthlyCost: 8320 },
  { id: 'm-3', name: 'GPT-4o', type: 'multimodal', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-***4o', enabled: false, isDefault: false, scope: 'employee', scopeTarget: ['e-1', 'e-3'], monthlyCost: 0 },
]

export const MOCK_SKILLS: Skill[] = [
  { id: 's-1', name: '商场日报生成', version: '1.2.0', description: '自动汇总楼层销售与客流数据生成日报。', enabled: true, source: 'enterprise', parsingStatus: 'success', scope: 'department', scopeTarget: ['d-1f', 'd-2f', 'd-3f', 'd-4f'] },
  { id: 's-2', name: '租户对账助手', version: '2.0.1', description: '辅助核对租户租金与流水。', enabled: true, source: 'enterprise', parsingStatus: 'success', scope: 'all', scopeTarget: [] },
  { id: 's-3', name: '个人待办整理', version: '0.5.0', description: '员工个人待办清单整理技能。', enabled: true, source: 'personal', parsingStatus: 'success', scope: 'employee', scopeTarget: ['e-2'] },
]

export const MOCK_CONNECTORS: Connector[] = [
  {
    id: 'c-1',
    name: '商场 MCP',
    type: 'mcp',
    enabled: true,
    tools: [
      { id: 'ct-1', name: 'query_sales', description: '查询销售数据', allowed: true },
      { id: 'ct-2', name: 'query_tenant', description: '查询租户信息', allowed: true },
      { id: 'ct-3', name: 'update_inventory', description: '更新库存', allowed: false },
    ],
    scope: 'department',
    scopeTarget: ['d-1f', 'd-2f', 'd-3f', 'd-4f', 'd-self'],
  },
  {
    id: 'c-2',
    name: '飞书办公',
    type: 'lark',
    enabled: true,
    tools: [
      { id: 'ct-4', name: 'send_message', description: '发送消息', allowed: true },
      { id: 'ct-5', name: 'create_doc', description: '创建文档', allowed: true },
    ],
    scope: 'all',
    scopeTarget: [],
  },
]

export const MOCK_EXPERTS: Expert[] = [
  { id: 'ex-1', name: '营运分析专家', description: '擅长商场营运数据分析与报告撰写。', enabled: true, tags: ['营运', '数据分析'], source: 'dsh', scope: 'department', scopeTarget: ['d-self'] },
  { id: 'ex-2', name: '客户服务专家', description: '基于百炼 API 的客户咨询专家。', enabled: true, tags: ['客服', '百炼'], source: 'external', externalConfig: { apiUrl: 'https://bailian.example.com/api', apiKey: 'sk-***bl' }, scope: 'all', scopeTarget: [] },
]

export const MOCK_BACKUPS: BackupRecord[] = [
  { id: 'b-1', name: 'backup-20261013-0200', time: '2026-10-13 02:00', createdAt: '2026-10-13 02:00', type: 'manual', size: 1024 * 1024 * 128, sizeBytes: 1024 * 1024 * 128, status: 'success' },
  { id: 'b-2', name: 'backup-20261010-0200', time: '2026-10-10 02:00', createdAt: '2026-10-10 02:00', type: 'manual', size: 1024 * 1024 * 112, sizeBytes: 1024 * 1024 * 112, status: 'success' },
]

export const MOCK_VERSIONS: VersionPackage[] = [
  { id: 'v-1', version: '1.3.0', platform: 'windows', size: 1024 * 1024 * 156, sizeBytes: 1024 * 1024 * 156, releaseTime: '2026-10-12 10:00', publishedAt: '2026-10-12 10:00', forceUpdate: true, enabled: true, status: 'published', releaseNotes: '修复登录稳定性，优化模型选择体验。' },
  { id: 'v-2', version: '1.3.0', platform: 'macos', size: 1024 * 1024 * 162, sizeBytes: 1024 * 1024 * 162, releaseTime: '2026-10-12 10:00', publishedAt: '2026-10-12 10:00', forceUpdate: true, enabled: true, status: 'published', releaseNotes: '修复登录稳定性，优化模型选择体验。' },
  { id: 'v-3', version: '1.2.5', platform: 'windows', size: 1024 * 1024 * 150, sizeBytes: 1024 * 1024 * 150, releaseTime: '2026-09-28 10:00', publishedAt: '2026-09-28 10:00', forceUpdate: false, enabled: true, status: 'published', releaseNotes: '常规问题修复。' },
]

export const MOCK_VERSION_REPORTS: EmployeeVersionReport[] = [
  { employeeId: 'e-1', employeeName: '张 Tong', version: '1.3.0', platform: 'windows', lastReportTime: '2026-10-13 09:00', lastReportAt: '2026-10-13 09:00', osVersion: 'Windows 11', updateStatus: 'updated' },
  { employeeId: 'e-2', employeeName: '李 Kai', version: '1.2.5', platform: 'macos', lastReportTime: '2026-10-12 18:00', lastReportAt: '2026-10-12 18:00', osVersion: 'macOS 15', updateStatus: 'pending' },
  { employeeId: 'e-3', employeeName: '王 Fang', version: '1.2.5', platform: 'windows', lastReportTime: '2026-10-10 10:00', lastReportAt: '2026-10-10 10:00', osVersion: 'Windows 10', updateStatus: 'offline' },
]

export const MOCK_OPERATION_LOGS: OperationLog[] = [
  { id: 'l-1', time: '2026-10-13 09:30', type: 'employee', object: '陈 Mei', change: '新增员工', operator: 'admin' },
  { id: 'l-2', time: '2026-10-13 09:15', type: 'model', object: 'DeepSeek-R1', change: '启用模型', operator: 'admin' },
  { id: 'l-3', time: '2026-10-12 17:00', type: 'backup', object: 'backup-20261013-0200', change: '手动备份', operator: 'admin' },
  { id: 'l-4', time: '2026-10-12 10:05', type: 'version', object: '1.3.0', change: '发布强制更新', operator: 'admin' },
]

export const MOCK_RECENT_ERRORS: RecentError[] = [
  { id: 'err-1', time: '2026-10-13 08:12', service: 'model-gateway', message: '调用 DeepSeek-V3 超时' },
  { id: 'err-2', time: '2026-10-12 22:45', service: 'connector-mcp', message: '商场 MCP 连接短暂中断' },
]

export const MOCK_USAGE_TREND: UsagePoint[] = [
  { date: '10/08', conversations: 120, tokens: 45000, activeEmployees: 18 },
  { date: '10/09', conversations: 145, tokens: 52000, activeEmployees: 20 },
  { date: '10/10', conversations: 132, tokens: 48000, activeEmployees: 19 },
  { date: '10/11', conversations: 168, tokens: 61000, activeEmployees: 22 },
  { date: '10/12', conversations: 190, tokens: 72000, activeEmployees: 24 },
  { date: '10/13', conversations: 156, tokens: 58000, activeEmployees: 21 },
]

export const MOCK_ACTIVITIES: DashboardActivity[] = [
  { id: 'a-1', time: '2026-10-13 09:30', type: 'employeeAdded', message: '新增员工 陈 Mei' },
  { id: 'a-2', time: '2026-10-13 09:15', type: 'modelTested', message: 'DeepSeek-R1 连通性测试通过' },
  { id: 'a-3', time: '2026-10-12 17:00', type: 'backupCreated', message: '完成手动数据备份' },
  { id: 'a-4', time: '2026-10-12 10:05', type: 'versionReleased', message: '发布 v1.3.0 强制更新' },
  { id: 'a-5', time: '2026-10-11 16:40', type: 'skillPublished', message: '企业技能「租户对账助手」已发布' },
]

export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n-1', title: 'v1.3.0 版本更新通知', content: '员工客户端已推送 v1.3.0 强制更新，请及时安装。', sentAt: '2026-10-12 10:00' },
  { id: 'n-2', title: '国庆节放假安排', content: '10 月 1 日至 7 日放假，请大家提前备份工作数据。', sentAt: '2026-09-28 18:00' },
]

export const MOCK_SYSTEM_METRIC: SystemMetric = {
  cpuPercent: 24,
  memoryPercent: 58,
  diskPercent: 42,
  gatewayStatus: 'online',
}

export const MOCK_ADMIN = {
  username: 'admin',
  password: 'lfclaw-admin-2026',
  displayName: '超级管理员',
}

/** Friendly named exports used by pages. */
export const departments: Department[] = []
export const employees: Employee[] = []
export const models: Model[] = []
export const skills: Skill[] = []
export const connectors: Connector[] = []
export const experts: Expert[] = []
export const backups: BackupRecord[] = []
export const versionPackages: VersionPackage[] = []
export const employeeVersionReports: EmployeeVersionReport[] = []
export const operationLogs: OperationLog[] = []
export const recentActivities: DashboardActivity[] = []
export const dashboardTrend: UsagePoint[] = []
export const notifications: Notification[] = []
export const systemMetric: SystemMetric = {
  cpuPercent: 0,
  memoryPercent: 0,
  diskPercent: 0,
  gatewayStatus: 'offline',
}

export const systemErrors: SystemError[] = []

export function findDepartmentById(id: string, list: Department[] = departments): Department | undefined {
  return list.find(d => d.id === id)
}

export function getDepartmentChildren(parentId: string | null, list: Department[] = departments): Department[] {
  return list.filter(d => d.parentId === parentId)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('zh-CN')}`
}

export function formatDate(value: string): string {
  return value
}

export function generateActivationCode(name: string): string {
  const suffix = Math.random().toString(36).slice(2, 10).toUpperCase()
  return `LF-${name.replace(/\s+/g, '').toUpperCase()}-${suffix}`
}

export const formatCost = formatCurrency
export const formatSize = formatBytes
