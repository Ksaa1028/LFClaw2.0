/** 模型计价字段与每次调用的费用计算。 */
import type { RecordItem } from './store.ts'

/** 单价按每百万 Token 计。 */
export interface Pricing { inputRate: number; outputRate: number; currency: string }

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 两项单价须同时配置，并提供三字母币种。
 * @param item 模型配置。
 * @returns 价格字段是否完整有效。
 */
export function validPricing(item: RecordItem): boolean {
  const input = item.pricePerMillionInput
  const output = item.pricePerMillionOutput
  if (input == null && output == null) return true
  return validRate(input) && validRate(output)
    && typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency)
}

/** 从模型记录生成本次调用使用的价格快照。
 * @param item 模型配置。
 * @returns 可用价格；未配置或无效时为 null。
 */
export function pricingOf(item: RecordItem): Pricing | null {
  if (!validPricing(item) || !validRate(item.pricePerMillionInput)
    || !validRate(item.pricePerMillionOutput) || typeof item.currency !== 'string') return null
  return { inputRate: item.pricePerMillionInput, outputRate: item.pricePerMillionOutput, currency: item.currency }
}

/** 金额保留六位小数，单位由记录中的币种指定。
 * @param pricing 调用时价格快照。
 * @param input 上游返回的输入 Token 数。
 * @param output 上游返回的输出 Token 数。
 * @returns 可计算的费用；用量或价格缺失时为 null。
 */
export function costOf(pricing: Pricing | null, input: unknown, output: unknown): number | null {
  if (!pricing || typeof input !== 'number' || typeof output !== 'number'
    || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return null
  const millionths = input * pricing.inputRate + output * pricing.outputRate
  return Number.isSafeInteger(Math.round(millionths)) ? Math.round(millionths) / 1_000_000 : null
}
