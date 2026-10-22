import type { ReactNode } from 'react'
import css from './PageShell.module.css'

export interface PageShellProps {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
}

export function PageShell({ title, subtitle, action, children }: PageShellProps): ReactNode {
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.titles}>
          <h1 className={css.title}>{title}</h1>
          {subtitle != null && subtitle !== '' && (
            <p className={css.subtitle}>{subtitle}</p>
          )}
        </div>
        {action != null && <div className={css.action}>{action}</div>}
      </header>
      <div className={css.body}>{children}</div>
    </div>
  )
}
