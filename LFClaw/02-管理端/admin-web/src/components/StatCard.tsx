import type { ReactNode } from 'react'
import css from './StatCard.module.css'

export interface StatCardProps {
  label: string
  value: ReactNode
  description?: string
  icon?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info'
}

export function StatCard({
  label,
  value,
  description,
  icon,
  tone = 'default',
}: StatCardProps): ReactNode {
  return (
    <div className={css.card} data-tone={tone}>
      <div className={css.header}>
        <span className={css.icon}>{icon}</span>
        <span className={css.label}>{label}</span>
      </div>
      <strong className={css.value}>{value}</strong>
      {description != null && description !== '' && (
        <small className={css.description}>{description}</small>
      )}
    </div>
  )
}
