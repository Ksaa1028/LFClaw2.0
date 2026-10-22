/** 会话行菜单和应用级确认框。 */
import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseMenuOpenState } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** 用户明确选中的会话。 */
export interface DeleteTarget { sessionId: SessionId; title: string }
/** 删除确认的源与回调。 */
export interface DeleteInjected {
  hooks: { pending: HostObservable<DeleteTarget | null> }
  settle: () => void
  remove: (id: SessionId) => Promise<void>
}
type MenuProps = PropsRuntime<'sidebar.workspaces.session.menu.item'> & PropsLocale<'sessionActions'> & {
  useMenuOpenState: UseMenuOpenState
  requestDelete: (target: DeleteTarget) => void
}
/** 菜单的删除操作。 @param props - 会话与确认入口。 @returns 删除菜单项。 */
export function DeleteSessionMenu(props: MenuProps) {
  const [, setOpen] = props.useMenuOpenState()
  return <MenuItemButton icon={<IconTrashOutlineRegular size={14} />} onSelect={() => {
    setOpen(false)
    props.requestDelete({ sessionId: props.sessionId, title: props.displayTitle })
  }}>{props.t('delete')}</MenuItemButton>
}
type DialogProps = PropsRuntime<'shell.overlay'> & PropsLocale<'sessionActions'> & PropsHooks<DeleteInjected['hooks']> & Omit<DeleteInjected, 'hooks'>
/** 确认框独立于菜单生命周期，失败不关闭。 @param props - 删除源和动作。 @returns 确认框与结果提示。 */
export function DeleteSessionDialog(props: DialogProps) {
  const pending = props.usePending(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState(0)
  const close = () => { if (!busy) { setFailed(false); props.settle() } }
  return <>
    {pending && <Modal open onClose={close} closeLabel={props.t('close')} title={props.t('title')}
      description={props.t('description', { title: pending.title })} footer={<>
        <Button variant="outline" disabled={busy} onClick={close}>{props.t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => {
          setBusy(true); setFailed(false)
          void props.remove(pending.sessionId).then(() => {
            setBusy(false); props.settle(); setNotice(value => value + 1)
          }).catch(() => { setBusy(false); setFailed(true) })
        }}>{props.t(busy ? 'busy' : 'confirm')}</Button>
      </>}>{failed && <p role="alert">{props.t('failed')}</p>}</Modal>}
    {notice > 0 && <Toast key={notice} tone="success" text={props.t('success')} onDone={() => { setNotice(0) }} />}
  </>
}
