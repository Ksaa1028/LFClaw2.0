/** AI 工作草稿的响应校验；草稿不创建流程或发送通知。 */
import { WorkflowError } from './workflow.ts'

/** 校验模型建议，只接受当前可选员工和带时区的时间。
 * @param content - 模型返回的 JSON 文本。
 * @param employeeIds - 当前在职员工 ID。
 * @returns 待员工确认的草稿与追问。
 */
export function parseWorkflowDraft(content: string, employeeIds: Set<string>) {
  let value: unknown
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
  catch (_error) { throw new WorkflowError(502, 'DRAFT_FAILED', 'AI 未能整理有效草稿，请重试') }
  if (!value || typeof value !== 'object') throw new WorkflowError(502, 'DRAFT_FAILED', 'AI 草稿格式无效')
  const v = value as Record<string, unknown>
  for (const key of ['reply', 'title', 'summary', 'requirement', 'assignee', 'reviewer', 'deadline']) {
    if (typeof v[key] !== 'string' || v[key].length > (key === 'title' ? 160 : 16000))
      throw new WorkflowError(502, 'DRAFT_FAILED', 'AI 草稿字段无效')
  }
  if (!v.reply || !Array.isArray(v.cc) || v.cc.some(id => typeof id !== 'string' || !employeeIds.has(id))
    || [v.assignee, v.reviewer].some(id => id !== '' && !employeeIds.has(String(id)))
    || v.deadline !== '' && (typeof v.deadline !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(v.deadline) || !Number.isFinite(Date.parse(v.deadline))))
    throw new WorkflowError(502, 'DRAFT_FAILED', 'AI 建议中的人员或日期无效，请重试')
  return { reply: String(v.reply), title: String(v.title), summary: String(v.summary), requirement: String(v.requirement),
    assignee: String(v.assignee), reviewer: String(v.reviewer), deadline: String(v.deadline), cc: [...new Set(v.cc as string[])] }
}
