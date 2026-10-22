import type { ReactNode } from 'react'
import {
  IconDatabaseOutlineMedium,
  IconDataOutlineMedium,
  IconGaugeOutlineMedium,
  IconGlobeOutlineMedium,
  Button,
  IconPlanOutlineMedium,
  IconShieldOutlineMedium,
  IconSkillOutlineMedium,
  IconUsersOutlineMedium,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { StatCard } from '../components/StatCard.tsx'
import { SimpleChart } from '../components/SimpleChart.tsx'
import { Pagination, usePaginatedData } from '../components/Pagination.tsx'
import { useAppState } from '../store.ts'
import type { Translate } from '../locales/index.ts'
import css from './DashboardPage.module.css'

export interface DashboardPageProps {
  t: Translate
  onRefresh: () => void
}

export function DashboardPage({ t, onRefresh }: DashboardPageProps): ReactNode {
  const { state } = useAppState()
  const enabledModels = state.models.filter(m => m.enabled).length
  const hasErrors = state.systemErrors.length > 0
  const monthlyCost = state.monthlyCost.status === 'calculated'
    && typeof state.monthlyCost.amount === 'number' && Number.isFinite(state.monthlyCost.amount) && state.monthlyCost.currency
    ? `${state.monthlyCost.currency === 'CNY' ? '¥' : state.monthlyCost.currency} ${state.monthlyCost.amount.toFixed(2)}`
    : t(state.monthlyCost.status === 'partial' ? 'models.costPartial'
      : state.monthlyCost.status === 'multiple' ? 'models.multipleCurrencies' : 'models.costUnavailable')
  const hasTrend = state.dashboardTrend.some(point => point.conversations > 0)
  const missingTokenCalls = state.dashboardTrend.reduce((sum, point) => sum + (point.missingTokenCalls ?? 0), 0)
  const hasActivities = state.recentActivities.length > 0
  const activities = usePaginatedData(state.recentActivities)

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p>{t('dashboard.subtitle')}</p>
        </div>
        <Button onClick={onRefresh}>{t('dashboard.refresh')}</Button>
      </header>

      <section className={css.stats}>
        <StatCard
          label={t('dashboard.employees')}
          value={String(state.employees.length)}
          icon={<IconUsersOutlineMedium size={18} />}
          tone="info"
        />
        <StatCard
          label={t('dashboard.departments')}
          value={String(state.departments.length)}
          icon={<IconDataOutlineMedium size={18} />}
        />
        <StatCard
          label={t('dashboard.models')}
          value={enabledModels + '/' + state.models.length}
          icon={<IconGlobeOutlineMedium size={18} />}
          tone="success"
        />
        <StatCard
          label={t('dashboard.skills')}
          value={String(state.skills.length)}
          icon={<IconSkillOutlineMedium size={18} />}
        />
        <StatCard
          label={t('dashboard.connectors')}
          value={String(state.connectors.length)}
          icon={<IconDatabaseOutlineMedium size={18} />}
        />
        <StatCard
          label={t('dashboard.experts')}
          value={String(state.experts.length)}
          icon={<IconShieldOutlineMedium size={18} />}
        />
        <StatCard
          label={t('dashboard.monthlyCost')}
          value={monthlyCost}
          icon={<IconPlanOutlineMedium size={18} />}
          tone="warning"
        />
        <StatCard
          label={t('dashboard.systemStatus')}
          value={hasErrors ? t('system.degraded') : t('system.online')}
          icon={<IconGaugeOutlineMedium size={18} />}
          tone={hasErrors ? 'error' : 'success'}
        />
      </section>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <h2>{t('dashboard.usageTrend')}</h2>
          <Tag tone="neutral">{t('dashboard.trendPeriod')}</Tag>
        </div>
        <p className={css.description}>{t('dashboard.trendDescription')}</p>
        {missingTokenCalls > 0 && <p role="status" className={css.description}>{t('dashboard.partialTokens', { count: missingTokenCalls })}</p>}
        {hasTrend
          ? (
            <SimpleChart
              labels={state.dashboardTrend.map(p => p.date.slice(5))}
              series={[
                {
                  key: 'conversations',
                  label: t('dashboard.modelCalls'),
                  color: 'var(--dsw-alias-state-business-primary)',
                  values: state.dashboardTrend.map(p => p.conversations),
                },
                {
                  key: 'tokens',
                  label: t('dashboard.tokensThousands'),
                  color: 'var(--dsw-alias-state-success-primary)',
                  values: state.dashboardTrend.map(p => p.tokens / 1000),
                },
                {
                  key: 'activeEmployees',
                  label: t('dashboard.activeEmployees'),
                  color: 'var(--dsw-alias-state-warn-primary)',
                  values: state.dashboardTrend.map(p => p.activeEmployees),
                },
              ]}
              height={240}
            />
          )
          : <p className={css.empty}>{t('dashboard.emptyTrend')}</p>}
      </section>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <h2>{t('dashboard.recentActivity')}</h2>
          <Tag tone="neutral">{t('dashboard.activityLimit')}</Tag>
        </div>
        {hasActivities
          ? (
            <ul className={css.activityList}>
              {activities.items.map(activity => (
                <li key={activity.id}>
                  <time className={css.activityTime} dateTime={activity.time}>{new Date(activity.time).toLocaleString()}</time>
                  <Tag tone="info">{t(`dashboard.activityTypes.${activity.type}`)}</Tag>
                  <span className={css.activityMessage}>{activity.message}</span>
                </li>
              ))}
            </ul>
          )
          : <p className={css.empty}>{t('dashboard.emptyActivity')}</p>}
        <Pagination page={activities.page} total={activities.total} onPageChange={activities.setPage} t={t} />
      </section>
    </div>
  )
}
