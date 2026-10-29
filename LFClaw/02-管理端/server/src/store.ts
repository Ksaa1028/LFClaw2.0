import { validWorkItems, type WorkItem } from './workflow.ts'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultBranding, validBranding, type Branding } from './branding.ts'
import { validExpertCapabilities } from './expert-definition.ts'
import { validConnectorAccounts, type ConnectorAccount } from './connector-account.ts'

export const collectionNames = [
  'departments', 'employees', 'models', 'skills', 'connectors', 'experts',
  'backups', 'versionPackages', 'operationLogs',
  'recentActivities', 'notifications', 'systemErrors',
] as const

export const mutableCollectionNames = [
  'departments', 'employees', 'models', 'skills', 'connectors', 'experts',
] as const

export type CollectionName = typeof collectionNames[number]
export type RecordItem = Record<string, unknown> & { id: string }
export type Database = Record<CollectionName, RecordItem[]> & {
  workflows: WorkItem[]
  branding: Branding
  personalSkillReports: RecordItem[]
  personalExperts: RecordItem[]
  connectorAccounts: ConnectorAccount[]
  modelUsage: RecordItem[]
  employeeVersionReports: Record<string, unknown>[]
  dashboardTrend: Record<string, unknown>[]
  systemMetric: Record<string, unknown>
}

export class StoreError extends Error {
  constructor(readonly code: 'DATA_INVALID' | 'DATA_IO', message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

function emptyDatabase(): Database {
  return {
    workflows: [],
    branding: { ...defaultBranding },
    departments: [], employees: [], models: [], skills: [], connectors: [], experts: [],
    personalSkillReports: [], personalExperts: [], connectorAccounts: [],
    backups: [], versionPackages: [], employeeVersionReports: [], operationLogs: [], modelUsage: [],
    recentActivities: [], dashboardTrend: [], notifications: [], systemErrors: [],
    systemMetric: { cpuPercent: 0, memoryPercent: 0, diskPercent: 0, gatewayStatus: 'offline' },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDatabase(value: unknown): Database {
  if (!isRecord(value)) throw new StoreError('DATA_INVALID', '数据文件顶层必须是对象')
  if (value.workflows === undefined) value.workflows = []
  if (!validWorkItems(value.workflows)) throw new StoreError('DATA_INVALID', '工作流记录损坏，原数据已保留')
  if (value.branding === undefined) value.branding = { ...defaultBranding }
  if (!validBranding(value.branding)) throw new StoreError('DATA_INVALID', '首页文案配置无效')
  for (const name of collectionNames) {
    if (!Array.isArray(value[name])) throw new StoreError('DATA_INVALID', `数据集合 ${name} 缺失或格式错误`)
    const seen = new Set<string>()
    for (const item of value[name]) {
      if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 || seen.has(item.id)) {
        throw new StoreError('DATA_INVALID', `数据集合 ${name} 存在无效或重复的 ID`)
      }
      if (name === 'experts' && !validExpertCapabilities(item)) throw new StoreError('DATA_INVALID', '专家依赖配置格式错误')
      if (name === 'notifications' && item.revokedAt !== undefined
        && (typeof item.revokedAt !== 'string' || !Number.isFinite(Date.parse(item.revokedAt)))) {
        throw new StoreError('DATA_INVALID', '公告撤回时间格式错误')
      }
      seen.add(item.id)
    }
  }
  if (!Array.isArray(value.employeeVersionReports) || !Array.isArray(value.dashboardTrend)) {
    throw new StoreError('DATA_INVALID', '统计数据格式错误')
  }
  if (!isRecord(value.systemMetric)) throw new StoreError('DATA_INVALID', '系统状态格式错误')
  if (value.modelUsage === undefined) value.modelUsage = []
  if (!Array.isArray(value.modelUsage)) throw new StoreError('DATA_INVALID', '模型用量格式错误')
  if (value.personalSkillReports === undefined) value.personalSkillReports = []
  if (!Array.isArray(value.personalSkillReports) || value.personalSkillReports.some((item: unknown) => !isRecord(item)
    || Object.keys(item).some(key => !['id', 'ownerEmployeeId', 'deviceId', 'updatedAt', 'skills'].includes(key))
    || typeof item.id !== 'string' || typeof item.ownerEmployeeId !== 'string' || typeof item.deviceId !== 'string'
    || !/^[a-f0-9-]{36}$/.test(item.deviceId) || item.id !== `${item.ownerEmployeeId}:${item.deviceId}`
    || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt)) || !Array.isArray(item.skills)
    || item.skills.length > 500 || item.skills.some((entry: unknown) => !isRecord(entry)
      || Object.keys(entry).some(key => !['name', 'description', 'version', 'source', 'enabled'].includes(key))
      || typeof entry.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || entry.name.length > 60
      || typeof entry.description !== 'string' || entry.description.length > 2000 || typeof entry.version !== 'string'
      || entry.version.length > 64 || entry.source !== 'personal' || typeof entry.enabled !== 'boolean'))) {
    throw new StoreError('DATA_INVALID', '个人技能清单格式错误')
  }
  if (value.personalExperts === undefined) value.personalExperts = []
  if (value.connectorAccounts === undefined) value.connectorAccounts = []
  if (!validConnectorAccounts(value.connectorAccounts)) throw new StoreError('DATA_INVALID', '员工连接器账号格式错误')
  if (!Array.isArray(value.personalExperts) || value.personalExperts.some(item =>
    !isRecord(item) || typeof item.id !== 'string' || !item.id
    || typeof item.ownerEmployeeId !== 'string' || !item.ownerEmployeeId || !validExpertCapabilities(item))
    || new Set(value.personalExperts.map(item => item.id)).size !== value.personalExperts.length) {
    throw new StoreError('DATA_INVALID', '个人专家数据格式错误')
  }
  return value as Database
}

/** 校验备份中的完整数据库，失败时不修改现有数据。
 * @param value 解码后的备份数据。
 * @returns 可写入的数据集合。
 */
export function validateDatabase(value: unknown): Database { return parseDatabase(value) }

/** One-process, synchronous JSON store. A failed read never changes the original file. */
export class JsonStore {
  private readonly listeners = new Set<() => void>()
  constructor(readonly path: string) {}

  /**
   * 订阅成功提交；监听失败不改变已提交结果。
   * @param listener - 提交后同步执行的通知。
   * @returns 调用方负责执行的订阅释放方法。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  read(): Database {
    if (!existsSync(this.path)) return emptyDatabase()
    let content: string
    try {
      content = readFileSync(this.path, 'utf8')
    } catch (cause) {
      throw new StoreError('DATA_IO', '无法读取数据文件', { cause })
    }
    try {
      return parseDatabase(JSON.parse(content))
    } catch (cause) {
      if (cause instanceof StoreError) throw cause
      throw new StoreError('DATA_INVALID', '数据文件不是有效 JSON，原文件已保留', { cause })
    }
  }

  update<T>(change: (db: Database) => T): T {
    const db = this.read()
    const result = change(db)
    const directory = dirname(this.path)
    mkdirSync(directory, { recursive: true })
    const temporary = join(directory, `.db-${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, JSON.stringify(db, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.path)
    } catch (cause) {
      throw new StoreError('DATA_IO', '保存失败，原数据未被覆盖', { cause })
    }
    for (const listener of this.listeners) {
      try { listener() }
      catch (error) { console.error('数据变更通知失败，请重新读取授权状态:', error instanceof Error ? error.name : 'unknown') }
    }
    return result
  }

  replace(value: unknown): void {
    const db = parseDatabase(value)
    this.update(current => {
      for (const name of collectionNames) current[name] = db[name]
      current.employeeVersionReports = db.employeeVersionReports
      current.dashboardTrend = db.dashboardTrend
      current.systemMetric = db.systemMetric
      current.workflows = db.workflows
      current.modelUsage = db.modelUsage
      current.personalExperts = db.personalExperts
      current.branding = db.branding
    })
  }
}

export function isCollectionName(name: string): name is CollectionName {
  return collectionNames.some(value => value === name)
}

export function isMutableCollectionName(name: string): name is typeof mutableCollectionNames[number] {
  return mutableCollectionNames.some(value => value === name)
}

export function isRecordItem(value: unknown): value is RecordItem {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
}
