/** 工作流入口复用现有主面板与侧栏注册。 */
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState } from 'react'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPlanOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { Workflows } from './Workflows.tsx'
import { workflowZh, workflowEn, type WorkflowKey } from './workflow-locales.ts'
import css from './Sharing.module.css'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { lfclawWorkflow: WorkflowKey } }
/** 注册员工工作流面板，卸载插件时撤销所有贡献。
 * @param ctx - 客户端上下文。
 * @param refreshIntervalMs - 沿用企业消息刷新周期。
 * @param notify - 应用生命周期内的反馈。
 */
export function registerWorkflows(ctx: Context, refreshIntervalMs: number, notify: (text: string) => void): void {
  ctx.effect(() => ctx.locale.register('lfclawWorkflow', { zh: workflowZh, en: workflowEn }), 'lfclaw: workflow locale')
  const panel = 'lfclaw-workflows' as MainPanelId
  function Page({ t }: PropsLocale<'lfclawWorkflow'>) { return <Workflows t={t} refreshIntervalMs={refreshIntervalMs} notify={notify} /> }
  function Icon({ size, t }: PropsLocale<'lfclawWorkflow'> & { size: number }) {
    const [count, setCount] = useState<number | null>(0)
    useEffect(() => {
      const controller = new AbortController()
      let running = false
      const refresh = async () => {
        if (running) return
        running = true
        try {
          const response = await fetch('/api/lfclaw/workflow-pending', { signal: controller.signal })
          const value: unknown = await response.json()
          if (!response.ok || !value || typeof value !== 'object' || !('count' in value) || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('INVALID_PENDING')
          if (!controller.signal.aborted) setCount(value.count)
        } catch (_error) { if (!controller.signal.aborted) setCount(null) }
        finally { running = false }
      }
      void refresh()
      const timer = setInterval(() => { void refresh() }, refreshIntervalMs)
      return () => { controller.abort(); clearInterval(timer) }
    }, [])
    return <span className={css.inboxIcon}><IconPlanOutlineRegular size={size} />
      {count === null ? <small className={css.badge} aria-label={t('failed')}>!</small>
        : count > 0 && <small className={css.badge} aria-label={t('todo')}>{count}</small>}</span>
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panel, locale: 'lfclawWorkflow' }, Page))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panel, order: 65, locale: 'lfclawWorkflow',
    label: () => ctx.locale.bind('lfclawWorkflow')('panel'),
  }, Icon))
}
