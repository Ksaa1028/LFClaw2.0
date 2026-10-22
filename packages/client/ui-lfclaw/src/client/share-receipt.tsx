/** A replayable divider between shared history and the receiver's local continuation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShareReceipt } from '../sharing-types.ts'
import css from './Sharing.module.css'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Source attribution and the beginning of receiver-owned history. */
    'lfclaw-share-receipt': ShareReceipt
  }
}
/** Pure event-to-divider fold, independent of the current share server state. */
export const shareReceiptDefinition: ConversationNodeDefinition<ShareReceipt> = {
  kind: 'lfclaw-share-receipt', target: 'chat',
  match: event => event.type === 'lfclaw/share-received' ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'lfclaw/share-received') throw new Error('Share receipt requires its owning event')
    return match.event.data
  },
  update: context => context.state,
  buildViewNode: (context): ChatNode<'lfclaw-share-receipt'> | null => {
    if (!context.state || !context.start) return null
    return { key: context.key, id: context.id, kind: 'lfclaw-share-receipt', target: 'chat', data: context.state,
      anchorSeq: context.start.event.seq, location: context.start.location, visibility: 'visible' }
  },
}
/** Render locally retained attribution at the original-history boundary.
 * @param props - Replayed receipt and localized copy.
 * @returns Source information and continuation divider.
 */
export function ShareReceiptDivider(props: { receipt: ShareReceipt } & PropsLocale<'sharing'>) {
  const receipt = props.receipt
  return <aside className={css.receipt}>
    <p>{props.t('receipt', { name: receipt.senderName, title: receipt.title, time: new Date(receipt.sharedAt).toLocaleString() })}</p>
    <p>{props.t('continuation')}</p>
  </aside>
}
/** Register the share divider through the Conversation business extension.
 * @param ctx - Chat and Conversation services.
 */
export function registerShareReceipt(ctx: Context): void {
  ctx.inject(['uiConversation'], (scope) => {
    scope.effect(() => scope.uiConversation.events.register(shareReceiptDefinition), 'lfclaw: receipt definition')
  })
  function Receipt(props: PropsRuntime<'conversation.chat.node', 'lfclaw-share-receipt'> & PropsLocale<'sharing'>) {
    return <ShareReceiptDivider receipt={props.node.data} t={props.t} />
  }
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node',
    key: 'lfclaw-share-receipt', locale: 'sharing',
  }, Receipt))
}
