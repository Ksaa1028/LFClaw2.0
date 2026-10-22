import type { ComponentProps, ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AdminModal.module.css'

/** 管理端弹窗将长内容限制在可滚动区域，保留标题和操作按钮。 */
export function AdminModal(props: ComponentProps<typeof Modal>): ReactNode {
  return <Modal {...props}
    className={[css.dialog, props.className].filter(Boolean).join(' ')}
    contentClassName={[css.content, props.contentClassName].filter(Boolean).join(' ')} />
}
