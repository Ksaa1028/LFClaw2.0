import type { ReactNode } from 'react'
import { Button, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DetailDrawer.module.css'

export interface DetailDrawerProps {
  title: ReactNode
  closeLabel: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function DetailDrawer({
  title,
  closeLabel,
  open,
  onClose,
  children,
  footer,
}: DetailDrawerProps): ReactNode {
  if (!open) return null

  return (
    <div className={css.overlay} onClick={onClose} role="presentation">
      <div
        className={css.drawer}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className={css.header}>
          <h2 className={css.title}>{title}</h2>
          <Button variant="ghost" onClick={onClose} icon={<IconCloseOutlineRegular size={16} />} aria-label={closeLabel} />
        </header>
        <div className={css.body}>{children}</div>
        {footer != null && <div className={css.footer}>{footer}</div>}
      </div>
    </div>
  )
}
