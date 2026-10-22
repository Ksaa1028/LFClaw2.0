/** 管理操作摘要仅记录对象名称与允许展示的修改项，不保存配置值或凭据。 */
import { isCollectionName, type Database, type RecordItem } from './store.ts'

const resourceNames: Record<string, string> = {
  departments: '部门', employees: '员工', models: '模型', skills: '技能', connectors: '连接器',
  experts: '专家', backups: '备份', notifications: '通知', versionPackages: '版本',
  branding: '首页文案', 'admin-password': '管理员密码', activation: '员工激活码', 'mall-mcp': '商场数据权限',
}
const fieldNames: Record<string, string> = {
  description: '简介', isDefault: '默认模型', scope: '授权范围', scopeTarget: '授权对象',
  pricePerMillionInput: '输入单价', pricePerMillionOutput: '输出单价', currency: '计价币种',
  contextWindow: '上下文窗口', maxTokens: '最大输出 token 数', enableThinking: '思考模式',
  upstreamModelId: '上游模型', protocol: '模型协议', baseUrl: '接口地址', apiKey: '访问密钥',
  icon: '图标', version: '发布版本', zipPath: '技能包', headers: '认证配置', endpoint: '服务地址',
  transport: '传输方式', authMode: '认证方式', tools: '工具授权', showToolsInClient: '工具展示',
  command: '启动命令', args: '启动参数', env: '环境变量',
  mallDataPermissions: '商场数据权限',
  externalConfig: '外部专家配置', memberIds: '专家团成员', parentId: '上级部门', floor: '楼层',
  selfOperated: '营运自营标记', departmentId: '所属部门', employeeOverrides: '员工授权',
  instructions: '专家指令', tags: '标签', source: '专家类型',
  skillIds: '所需技能', connectorIds: '所需连接器', quickPrompts: '示例问题',
}
const activityTypes = {
  departments: 'departments', employees: 'employees', models: 'models', skills: 'skills',
  connectors: 'connectors', experts: 'experts', backups: 'backups', notifications: 'notifications',
  versionPackages: 'versions', branding: 'settings', 'admin-password': 'security',
  activation: 'security', 'mall-mcp': 'permissions',
} as const

function resourceName(collection: string, item: RecordItem): string {
  const label = collection === 'experts' && item.source === 'team' ? '专家团' : resourceNames[collection] ?? '对象'
  const name = typeof item.name === 'string' ? item.name : typeof item.title === 'string' ? item.title : null
  return name ? `${label}「${name}」` : `${label}（名称未记录，编号：${item.id}）`
}

/** 为新增、修改与删除保存可独立阅读的摘要，删除后仍保留操作时的对象名称。
 * @param collection 资源集合。
 * @param action 管理操作。
 * @param item 操作时的对象；删除使用删除前记录。
 * @param prior 修改前记录。
 * @returns 适合持久化和展示的中文摘要，配置仅记录字段名称。
 */
export function resourceOperationSummary(collection: string, action: 'create' | 'update' | 'delete', item: RecordItem, prior?: RecordItem): string {
  const target = resourceName(collection, item)
  if (action === 'create') return `已新增${target}`
  if (action === 'delete') return `已删除${target}`
  if (!prior) return `已修改${target}（修改明细未记录）`
  const changes: string[] = []
  if (prior) {
    if (prior.name !== item.name && typeof prior.name === 'string' && typeof item.name === 'string') {
      changes.push(`名称由「${prior.name}」改为「${item.name}」`)
    }
    if (prior.enabled !== item.enabled && typeof item.enabled === 'boolean') changes.push(item.enabled ? '启用' : '停用')
    if (prior.status !== item.status && (item.status === 'active' || item.status === 'inactive')) {
      changes.push(item.status === 'active' ? '启用员工' : '停用员工')
    }
    const fields = Object.entries(fieldNames).filter(([key]) => JSON.stringify(prior[key]) !== JSON.stringify(item[key])).map(([, label]) => label)
    if (fields.length) changes.push(`修改${fields.join('、')}`)
    const knownFields = new Set(['id', 'name', 'enabled', 'status', 'createdAt', 'updatedAt', 'history', 'revision', 'sha256', ...Object.keys(fieldNames)])
    if (Object.keys({ ...prior, ...item }).some(key => !knownFields.has(key) && JSON.stringify(prior[key]) !== JSON.stringify(item[key]))) {
      changes.push('修改其他配置')
    }
  }
  return changes.length ? `已修改${target}：${changes.join('；')}` : `已保存${target}（展示配置未发生变化）`
}

/** 将新摘要及旧操作日志转换为可读动态；旧数据缺失的名称和修改项明确标注。
 * @param log 管理员操作日志。
 * @param db 用于解析旧记录的当前资源目录。
 * @returns 动态分类和说明。
 */
export function operationActivity(log: RecordItem, db: Database) {
  const type = String(log.type)
  const [action, collection = ''] = type.split(':')
  const category = action === 'permission' ? 'permissions' as const
    : Object.hasOwn(activityTypes, collection) ? activityTypes[collection as keyof typeof activityTypes] : 'operation' as const
  if (typeof log.change === 'string' && log.change.startsWith('已')) return { type: category, message: log.change }
  const lookup = collection === 'activation' || collection === 'mall-mcp' ? 'employees' : collection
  const target = isCollectionName(lookup) ? db[lookup].find(item => item.id === log.object) : undefined
  const subject = collection === 'branding' ? '首页文案' : collection === 'admin-password' ? '管理员密码'
    : target ? resourceName(lookup, target) : `${resourceNames[collection] ?? '对象'}（名称未记录，编号：${String(log.object)}）`
  const verbs: Record<string, string> = { create: '新增', update: '修改', delete: '删除', rollback: '回退', reset: '重置', permission: '调整授权', change: '修改', restore: '恢复' }
  const description = verbs[action ?? ''] ?? '操作'
  const legacy = log.change === '新增记录' || log.change === '删除记录' || log.change === '更新记录'
  const detail = legacy ? action === 'update' ? '历史记录未保存修改明细' : '' : String(log.change)
  return { type: category, message: `已${description}${subject}${detail ? `：${detail}` : ''}` }
}
