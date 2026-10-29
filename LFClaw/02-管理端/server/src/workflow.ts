import type { Branded } from '@deepseek-ai/dsh-brand'
/** 员工工作流转的状态转换与持久化校验；管理员只读取元数据。 */
import { createHash, randomUUID } from 'node:crypto'

type WorkflowId = Branded<'LfclawWorkflowId'>
type EmployeeId = Branded<'LfclawWorkflowEmployeeId'>
type OperationId = Branded<'LfclawWorkflowOperationId'>
type Status = 'processing' | 'review' | 'supplement' | 'confirmation' | 'completed' | 'cancelled'
type Action = 'create' | 'transfer' | 'submit' | 'approve' | 'return' | 'ask' | 'supplement' | 'change' | 'accept' | 'cancel'
interface Artifact { name: string; url: string }
interface Entry { requirement?: string; deadline?: string; requestHash: string; operationId: OperationId; actor: EmployeeId; action: Action; time: string; original: string; summary: string; artifacts: Artifact[] }
/** 完整流转记录仅对参与员工开放，抄送人只取得最终结果。 */
export interface WorkItem {
  id: WorkflowId; title: string; creator: EmployeeId; assignee: EmployeeId; reviewer: EmployeeId
  participants: EmployeeId[]; cc: EmployeeId[]; status: Status; revision: number
  deadline: string; requirement: string; history: Entry[]; createdAt: string; updatedAt: string
  returnTo: EmployeeId; submittedBy: EmployeeId; finalEntry: number | null
}
/** 预期失败不会提交任何数据。 */
export class WorkflowError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 16000): v is string => typeof v === 'string' && v.length <= max
const nonempty = (v: unknown, max = 16000): v is string => text(v, max) && !!v.trim()
const ids = (v: unknown): v is EmployeeId[] => Array.isArray(v) && v.length <= 500 && v.every(x => nonempty(x, 200)) && new Set(v).size === v.length
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const uuid = (v: unknown): v is OperationId => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)
const actions: Action[] = ['create', 'transfer', 'submit', 'approve', 'return', 'ask', 'supplement', 'change', 'accept', 'cancel']
function artifacts(v: unknown): v is Artifact[] {
  return Array.isArray(v) && v.length <= 20 && v.every(a => {
    if (!record(a) || !nonempty(a.name, 200) || !nonempty(a.url, Number.MAX_SAFE_INTEGER)) return false
    if (a.url.startsWith('data:application/octet-stream;base64,')) {
      const data = a.url.slice(37); return /^[A-Za-z0-9+/]*={0,2}$/.test(data) && Buffer.from(data, 'base64').toString('base64') === data
    }
    if (a.url.length > 4000) return false
    try { const url = new URL(a.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password }
    catch (error) { return false /* 无效链接不进入产物记录。 */ }
  })
}
/** 校验磁盘记录，损坏时停止读取而不覆盖原文件。
 * @param value - 解码后的记录集合。
 * @returns 是否包含可解释的完整流转记录。
 */
export function validWorkItems(value: unknown): value is WorkItem[] {
  return Array.isArray(value) && new Set(value.map(v => record(v) ? v.id : undefined)).size === value.length && value.every(w => record(w)
    && uuid(w.id) && nonempty(w.title, 160) && nonempty(w.creator, 200) && nonempty(w.assignee, 200) && nonempty(w.reviewer, 200)
    && ids(w.participants) && ids(w.cc) && w.participants.includes(w.creator as EmployeeId) && w.participants.includes(w.assignee as EmployeeId)
    && ['processing', 'review', 'supplement', 'confirmation', 'completed', 'cancelled'].includes(String(w.status))
    && Number.isSafeInteger(w.revision) && Number(w.revision) >= 1 && date(w.deadline) && nonempty(w.requirement)
    && date(w.createdAt) && date(w.updatedAt) && text(w.returnTo, 200) && text(w.submittedBy, 200)
    && Array.isArray(w.history) && w.history.length === w.revision
    && new Set(w.history.map(e => record(e) ? e.operationId : undefined)).size === w.history.length
    && w.history.every(e => record(e) && uuid(e.operationId) && nonempty(e.actor, 200) && actions.includes(e.action as Action)
      && typeof e.requestHash === 'string' && /^[a-f0-9]{64}$/.test(e.requestHash) && (e.requirement === undefined || nonempty(e.requirement)) && (e.deadline === undefined || date(e.deadline)) && date(e.time) && nonempty(e.original) && text(e.summary) && artifacts(e.artifacts))
    && (w.finalEntry === null || Number.isSafeInteger(w.finalEntry) && Number(w.finalEntry) >= 0 && Number(w.finalEntry) < w.history.length)
    && (w.status !== 'completed' || w.finalEntry !== null))
}
function invalid(message: string): never { throw new WorkflowError(400, 'INVALID_INPUT', message) }
function person(value: unknown, active: Set<string>): EmployeeId {
  if (typeof value !== 'string' || !active.has(value)) invalid('请选择有效的在职员工')
  return value as EmployeeId
}
function entry(input: Record<string, unknown>, actor: EmployeeId, action: Action): Entry {
  if (!uuid(input.operationId) || !nonempty(input.original) || !nonempty(input.summary) || !artifacts(input.artifacts)) invalid('请填写处理说明、有效产物链接和交接摘要（可手工填写）')
  return { requestHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), operationId: input.operationId, actor, action, time: new Date().toISOString(), original: input.original.trim(), summary: input.summary.trim(), artifacts: input.artifacts.map(a => ({ name: a.name, url: a.url })) }
}
/** 创建或推进流程；调用方在同一存储事务内提供当前员工目录。
 * @param items - 事务内可变集合。
 * @param actorId - 已认证员工。
 * @param input - 不可信 HTTP 输入。
 * @param active - 当前有效员工 ID。
 * @returns 已提交候选记录，存储成功后才能响应。
 */
export function mutateWorkflow(items: WorkItem[], actorId: string, input: unknown, active: Set<string>): WorkItem {
  if (!record(input)) invalid('工作流请求格式错误')
  const actor = person(actorId, active)
  if (input.action === 'create') {
    const event = entry(input, actor, 'create')
    const prior = items.find(w => w.creator === actor && w.history[0]?.operationId === event.operationId)
    if (prior) {
      if (prior.history[0]?.requestHash !== event.requestHash) throw new WorkflowError(409, 'OPERATION_CONFLICT', '该提交标识已使用，请核对已提交记录')
      return prior
    }
    if (!nonempty(input.title, 160) || !nonempty(input.requirement) || !date(input.deadline) || !ids(input.cc)) invalid('请确认标题、需求、期限和抄送人')
    const assignee = person(input.assignee, active), reviewer = person(input.reviewer, active)
    const cc = input.cc.map(id => person(id, active))
    event.requirement = input.requirement.trim(); event.deadline = input.deadline
    const item: WorkItem = { id: randomUUID() as WorkflowId, title: input.title.trim(), creator: actor, assignee, reviewer,
      participants: [...new Set([actor, assignee, reviewer])], cc, status: 'processing', revision: 1,
      deadline: input.deadline, requirement: input.requirement.trim(), history: [event], createdAt: event.time, updatedAt: event.time,
      returnTo: actor, submittedBy: actor, finalEntry: null }
    items.push(item); return item
  }
  const w = items.find(item => item.id === input.id && item.participants.includes(actor))
  if (!w) throw new WorkflowError(404, 'NOT_FOUND', '工作流不存在或你无权查看')
  if (!actions.includes(input.action as Action) || input.action === 'create') invalid('不支持此操作')
  const action = input.action as Action, event = entry(input, actor, action)
  const previous = w.history.find(e => e.operationId === event.operationId)
  if (previous) {
    if (previous.actor !== actor || previous.requestHash !== event.requestHash) throw new WorkflowError(409, 'OPERATION_CONFLICT', '该提交标识已使用，请核对已提交记录')
    return w
  }
  if (input.revision !== w.revision) throw new WorkflowError(409, 'REVISION_CONFLICT', '工作流已更新，请刷新后核对当前负责人再操作')
  if (w.status === 'completed' || w.status === 'cancelled') throw new WorkflowError(409, 'CLOSED', '工作流已结束')
  const allowed = action === 'cancel' ? actor === w.creator : action === 'change' ? actor === w.creator && w.status === 'processing'
    : actor === w.assignee && (w.status === 'review' ? ['approve', 'return'].includes(action)
      : w.status === 'confirmation' ? action === 'accept' : w.status === 'supplement' ? action === 'supplement' : ['transfer', 'submit', 'ask'].includes(action))
  if (!allowed) throw new WorkflowError(403, 'FORBIDDEN', '当前人员或环节不能执行此操作')
  if (action === 'transfer') w.assignee = person(input.target, active)
  if (action === 'ask') { w.returnTo = w.assignee; w.assignee = w.creator; w.status = 'supplement' }
  if (action === 'supplement') { w.assignee = person(w.returnTo, active); w.status = 'processing' }
  if (action === 'change') {
    if (!nonempty(input.requirement) || !date(input.deadline)) invalid('请填写新的完整需求和期限')
    event.requirement = input.requirement.trim(); event.deadline = input.deadline
    w.requirement = input.requirement.trim(); w.deadline = input.deadline; w.status = 'confirmation'
  }
  if (action === 'accept') w.status = 'processing'
  if (action === 'submit') { w.submittedBy = w.assignee; w.assignee = person(w.reviewer, active); w.status = 'review' }
  if (action === 'return') { w.assignee = person(w.submittedBy, active); w.status = 'processing' }
  if (action === 'approve') { w.status = 'completed'; w.finalEntry = w.history.findLastIndex(e => e.action === 'submit') }
  if (action === 'cancel') w.status = 'cancelled'
  w.participants = [...new Set([...w.participants, w.assignee])]
  w.history.push(event); w.revision++; w.updatedAt = event.time
  return w
}
/** 生成员工可见记录；完结抄送不泄露过程。
 * @param w - 完整持久化记录。
 * @param employee - 当前员工 ID。
 * @returns 可见记录或不可见标志。
 */
export function employeeWorkflow(w: WorkItem, employee: string) {
  if (w.participants.some(id => id === employee)) return { ...w, resultOnly: false }
  if (w.status !== 'completed' || !w.cc.some(id => id === employee) || w.finalEntry === null) return null
  return { id: w.id, title: w.title, creator: w.creator, assignee: w.assignee, reviewer: w.reviewer, status: w.status,
    revision: w.revision, deadline: w.deadline, createdAt: w.createdAt, updatedAt: w.updatedAt, resultOnly: true,
    history: [w.history[w.finalEntry], w.history.at(-1)] }
}
