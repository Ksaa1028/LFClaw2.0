/** 企业模型容量；旧记录保留原部署容量，非法配置抛出 TypeError。
 * @param model 持久化模型配置。
 * @returns 上下文窗口和单次输出上限。
 */
export function modelCapacity(model: Record<string, unknown>): { contextWindow: number; maxTokens: number } {
  const contextWindow = model.contextWindow === undefined ? 32768 : model.contextWindow
  const maxTokens = model.maxTokens === undefined ? 8192 : model.maxTokens
  if (typeof contextWindow !== 'number' || !Number.isSafeInteger(contextWindow) || contextWindow <= 0
    || typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > contextWindow) {
    throw new TypeError('模型上下文窗口和最大输出 token 数必须为正整数，输出不得超过上下文窗口')
  }
  return { contextWindow, maxTokens }
}
/** 校验模型创建或更新合并后的容量字段。
 * @param model 合并后的模型配置。
 * @returns 容量是否为正安全整数且输出不超过上下文。
 */
export function validModelCapacity(model: Record<string, unknown>): boolean {
  try { modelCapacity(model) } catch (error) { if (error instanceof TypeError) return false; throw error }
  return true
}

/** 可选的上游思考开关；缺省时保留模型供应商的默认行为。
 * @param model 持久化模型配置。
 * @returns 仅在管理员明确选择时传给上游的请求字段。
 */
export function modelThinkingOption(model: Record<string, unknown>): { enable_thinking?: boolean } {
  if (model.enableThinking === undefined || model.enableThinking === null) return {}
  if (typeof model.enableThinking !== 'boolean') throw new TypeError('模型思考模式必须为布尔值')
  return { enable_thinking: model.enableThinking }
}

/** @param model 合并后的模型配置。 @returns 思考开关是否有效。 */
export function validModelThinkingOption(model: Record<string, unknown>): boolean {
  try { modelThinkingOption(model) } catch (error) { if (error instanceof TypeError) return false; throw error }
  return true
}
