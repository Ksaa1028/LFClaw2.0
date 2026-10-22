import { useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { Button, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EmployeeProfile } from './employee.ts'
import css from './EmployeeBadge.module.css'
/** 员工资料来自当前激活验证，与侧栏宽度一起驱动展示。 */
export interface EmployeeBadgeProps extends SidebarFooterActionOwnerProps {
  useEmployee: SnapshotSelectorHook<EmployeeProfile | null>
  signOut: () => Promise<void>
  t: TranslateNS<'activation'>
}
/** Show employee details and confirm local sign-out. @param props - Employee, sidebar and sign-out controls. @returns Employee button and confirmation. */
export function EmployeeBadge({ useEmployee, signOut, wide, t }: EmployeeBadgeProps) {
  const employee = useEmployee(value => value)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const dismiss = () => {
    if (!busy) setOpen(false)
  }
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await signOut()
    } catch (error) {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  if (!employee) return null
  const department = employee.departmentName || t('noDepartment')
  return (
    <>
      <Tooltip label={t('signOut')} side="top">
        <button
          type="button"
          className={css.badge}
          data-wide={wide}
          aria-label={`${employee.name} · ${department}`}
          aria-haspopup="dialog"
          onClick={() => {
            setFailed(false)
            setOpen(true)
          }}
        >
          <span className={css.avatar} aria-hidden="true">
            {Array.from(employee.name)[0]}
          </span>
          {wide && (
            <span className={css.details}>
              <span className={css.name}>{employee.name}</span>
              <span className={css.department}>{department}</span>
            </span>
          )}
        </button>
      </Tooltip>
      <Modal open={open} title={t('signOut')} closeLabel={t('close')} onClose={dismiss}>
        <p>{t('signOutDescription')}</p>
        {failed && <p role="alert">{t('signOutFailed')}</p>}
        <div className={css.actions}>
          <Button disabled={busy} onClick={dismiss}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void confirm()
            }}
          >
            {t(busy ? 'signingOut' : 'signOut')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
