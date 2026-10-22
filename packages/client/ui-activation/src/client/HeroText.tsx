/** 企业欢迎文案在首页挂载及窗口重新获得焦点时刷新。 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

interface Branding {
  headline: string
  badge: string
  showBadge: boolean
}

/** 展示企业配置；读取失败保留上次文案并显示重试入口。
 * @param props - 宿主标签样式与本地化文案。
 * @returns 首页标题和可选标签。
 */
export function HeroText({ badgeClassName, t }: PropsRuntime<'conversation.hero.brand.text'> & PropsLocale<'activation'>) {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let controller: AbortController | undefined
    const refresh = async () => {
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const response = await fetch('/api/lfclaw/branding', { signal: current.signal })
        const value: unknown = await response.json()
        if (
          !response.ok ||
          !value ||
          typeof value !== 'object' ||
          !('headline' in value) ||
          typeof value.headline !== 'string' ||
          !value.headline.trim() ||
          value.headline.length > 40 ||
          !('badge' in value) ||
          typeof value.badge !== 'string' ||
          value.badge.length > 12 ||
          !('showBadge' in value) ||
          typeof value.showBadge !== 'boolean' ||
          (value.showBadge && !value.badge.trim()) ||
          /[\r\n\t]/.test(value.headline + value.badge)
        )
          throw new Error('Invalid branding response')
        if (!current.signal.aborted) {
          setBranding({ headline: value.headline, badge: value.badge, showBadge: value.showBadge })
          setFailed(false)
        }
      } catch (error) {
        if (!current.signal.aborted) setFailed(true)
      }
    }
    const onFocus = () => {
      void refresh()
    }
    onFocus()
    window.addEventListener('focus', onFocus)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', onFocus)
    }
  }, [attempt])
  return (
    <>
      <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{branding?.headline ?? t('heroHeadline')}</span>
      {branding?.showBadge && <span className={badgeClassName}>{branding.badge}</span>}
      {failed && (
        <button
          type="button"
          className={badgeClassName}
          onClick={() => {
            setAttempt(value => value + 1)
          }}
        >
          {t('heroRetry')}
        </button>
      )}
    </>
  )
}
