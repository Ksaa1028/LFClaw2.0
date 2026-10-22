/** 企业公开欢迎页文案；不包含员工或服务凭据。 */
export interface Branding {
  headline: string
  badge: string
  showBadge: boolean
}

/** 未配置企业欢迎页时使用的文案。 */
export const defaultBranding: Branding = { headline: '让想法落地，让工作轻松', badge: '预览版', showBadge: true }

/** 校验 HTTP 和持久化文案，限制单行长度。
 * @param value - 待校验数据。
 * @returns 是否为完整的欢迎页配置。
 */
export function validBranding(value: unknown): value is Branding {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.headline === 'string' && !!item.headline.trim() && item.headline.length <= 40
    && typeof item.badge === 'string' && item.badge.length <= 12
    && typeof item.showBadge === 'boolean' && (!item.showBadge || !!item.badge.trim())
    && !/[\r\n\t]/.test(item.headline + item.badge)
}
