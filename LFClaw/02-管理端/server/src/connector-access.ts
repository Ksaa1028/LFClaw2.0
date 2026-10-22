/** 连接器授权变更监视与请求期间的授权失效。 */
import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { permissionsForEmployee } from './mcp.ts'
import { employeeConnectors } from './mcp-policy.ts'
import type { JsonStore, RecordItem } from './store.ts'

/** 权限或连接配置变化后，旧请求结果不得下发。 */
export class ConnectorAccessChanged extends Error {
  readonly code = 'CONNECTOR_ACCESS_CHANGED'
  constructor() { super('连接器权限已变化，请按最新权限重新查询') }
}

/** 同一员工和连接器的授权、连接配置指纹；只在内存中使用原始配置。 */
function state(store: JsonStore, employee: RecordItem | null, connectorId?: string): string {
  if (!employee) return 'unauthorized'
  const db = store.read()
  return JSON.stringify({ employee: [employee.id, employee.status, employee.activationCode, employee.departmentId],
    permissions: permissionsForEmployee(db, employee),
    catalog: employeeConnectors(db, employee).filter(item => !connectorId || item.id === connectorId),
    configuration: db.connectors.filter(item => !connectorId || item.id === connectorId),
    accounts: db.connectorAccounts.filter(item => (item.owner === 'enterprise' || item.employeeId === employee.id) && (!connectorId || item.connectorId === connectorId))
      .map(item => [item.connectorId, item.revision, item.configuration, item.needsAuthorization]),
  })
}

/**
 * 在提交变更时中断受影响的请求，完成前再次验证；调用方必须 dispose。
 * @param store - 单进程配置存储。
 * @param resolveEmployee - 按当前令牌重新解析员工。
 * @param connectorId - 请求使用的连接器。
 * @param res - 员工请求响应，关闭时停止上游请求。
 * @returns 中止信号、完成前校验及订阅释放方法。
 */
export function guardConnectorAccess(store: JsonStore, resolveEmployee: () => RecordItem | null,
  connectorId: string, res: Response): { signal: AbortSignal; assertCurrent(): void; dispose(): void } {
  const initial = state(store, resolveEmployee(), connectorId)
  const controller = new AbortController()
  const check = () => {
    try { if (state(store, resolveEmployee(), connectorId) !== initial) controller.abort(new ConnectorAccessChanged()) }
    catch (error) { controller.abort(error) }
  }
  const unsubscribe = store.subscribe(check)
  const closed = () => { controller.abort(new Error('客户端已断开')) }
  res.once('close', closed)
  return { signal: controller.signal,
    assertCurrent() { check(); controller.signal.throwIfAborted() },
    dispose() { unsubscribe(); res.off('close', closed) },
  }
}

/**
 * 长轮询在授权、连接配置变化或等待结束时返回；断开即释放订阅。
 * @param store - 单进程配置存储。
 * @param resolveEmployee - 按当前令牌重新解析员工。
 * @param req - 可携带旧修订摘要的请求。
 * @param res - 返回最新目录或授权错误的响应。
 * @param waitMs - 单次等待上限，单位毫秒。
 */
export function sendConnectorCatalog(store: JsonStore, resolveEmployee: () => RecordItem | null,
  req: Request, res: Response, waitMs: number): void {
  let unsubscribe = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  const cleanup = () => { finished = true; unsubscribe(); clearTimeout(timer); res.off('close', cleanup) }
  const send = (force = false) => {
    if (finished) return
    try {
      const employee = resolveEmployee()
      if (!employee) { cleanup(); res.status(401).json({ code: 'UNAUTHORIZED' }); return }
      const revision = createHash('sha256').update(state(store, employee)).digest('hex')
      if (!force && req.query.revision === revision) return
      cleanup()
      res.setHeader('Cache-Control', 'no-store')
      res.json({ revision, connectors: employeeConnectors(store.read(), employee) })
    } catch (error) {
      cleanup()
      console.error('连接器授权读取失败:', error instanceof Error ? error.name : 'unknown')
      res.status(503).json({ code: 'CATALOG_UNAVAILABLE' })
    }
  }
  unsubscribe = store.subscribe(() => send())
  res.once('close', cleanup)
  timer = setTimeout(() => send(true), waitMs)
  send()
}
