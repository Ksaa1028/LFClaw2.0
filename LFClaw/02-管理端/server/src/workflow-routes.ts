/** 工作流员工操作和管理员只读目录。 */
import express from 'express'
import type { Request } from 'express'
import type { ServerOptions } from './app.ts'
import type { RecordItem } from './store.ts'
import { requireAdmin } from './auth.ts'
import { employeeWorkflow, mutateWorkflow, WorkflowError } from './workflow.ts'
import { parseWorkflowDraft } from './workflow-draft.ts'

/** 在企业 API 中挂载流程路由；身份在每次请求重新验证。
 * @param app - 企业应用。
 * @param options - 数据与认证服务。
 * @param employee - 当前凭据解析器。
 * @param summarize - 使用当前员工授权模型生成摘要。
 */
export function mountWorkflows(app: express.Express, options: ServerOptions & { workflowRequestMaxBytes: number }, employee: (req: Request) => RecordItem | null,
  summarize: (employee: RecordItem, original: string, mode: 'summary' | 'draft') => Promise<string>): void {
  app.use('/api/employee/workflows', (req, res, next) => {
    const identity = employee(req)
    if (!identity) { res.status(401).json({ code: 'UNAUTHORIZED', message: '请重新激活企业账号' }); return }
    res.setHeader('Cache-Control', 'no-store'); next()
  })
  app.use('/api/employee/workflows', express.json({ limit: options.workflowRequestMaxBytes }))
  app.get('/api/employee/workflows/pending', (req, res) => {
    const identity = employee(req)!
    res.json({ count: options.store.read().workflows.filter(w => w.assignee === identity.id && !['completed', 'cancelled'].includes(w.status)).length })
  })
  app.get('/api/employee/workflows', (req, res) => {
    const identity = employee(req)!, db = options.store.read()
    res.json({ maxRequestBytes: options.workflowRequestMaxBytes, employeeId: identity.id, employees: db.employees.filter(e => e.status === 'active').map(e => ({ id: e.id,
      name: String(e.name), department: String(db.departments.find(d => d.id === e.departmentId)?.name ?? '') })),
    items: db.workflows.map(w => employeeWorkflow(w, identity.id)).filter(w => w !== null).reverse() })
  })
  app.post('/api/employee/workflows', (req, res, next) => {
    try {
      const identity = employee(req)!
      const item = options.store.update(db => mutateWorkflow(db.workflows, identity.id, req.body,
        new Set(db.employees.filter(e => e.status === 'active').map(e => e.id))))
      res.json(employeeWorkflow(item, identity.id))
    } catch (error) {
      if (error instanceof WorkflowError) { res.status(error.status).json({ code: error.code, message: error.message }); return }
      next(error)
    }
  })
  app.post('/api/employee/workflows/summary', async (req, res, next) => {
    try {
      const input: unknown = req.body
      if (!input || typeof input !== 'object' || !('original' in input) || typeof input.original !== 'string'
        || !input.original.trim() || input.original.length > 16000) {
        res.status(400).json({ code: 'INVALID_INPUT', message: '请提供不超过 16000 字的原始内容' }); return
      }
      const mode = 'mode' in input ? input.mode : 'summary'
      if (mode !== 'summary' && mode !== 'draft') { res.status(400).json({ code: 'INVALID_INPUT' }); return }
      const identity = employee(req)!, summary = await summarize(identity, input.original, mode)
      if (!employee(req)) { res.status(401).json({ code: 'UNAUTHORIZED' }); return }
      res.json(mode === 'draft' ? parseWorkflowDraft(summary,
        new Set(options.store.read().employees.filter(e => e.status === 'active').map(e => e.id))) : { summary })
    } catch (error) {
      if (error instanceof WorkflowError) { res.status(error.status).json({ code: error.code, message: error.message }); return }
      next(error)
    }
  })
  app.get('/api/admin/workflows', requireAdmin(options.auth), (_req, res) => {
    const db = options.store.read()
    const person = (id: string) => {
      const e = db.employees.find(e => e.id === id)
      return { name: String(e?.name ?? id), department: String(db.departments.find(d => d.id === e?.departmentId)?.name ?? '') }
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json(db.workflows.map(w => ({ id: w.id, title: w.title, creator: person(w.creator), assignee: person(w.assignee),
      status: w.status, deadline: w.deadline, createdAt: w.createdAt, updatedAt: w.updatedAt,
      overdue: !['completed', 'cancelled'].includes(w.status) && Date.parse(w.deadline) < Date.now() })).reverse())
  })
}
