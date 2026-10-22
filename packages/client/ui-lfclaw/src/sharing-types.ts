/** Durable share attribution; the inherited history remains ordinary DSH events. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one enterprise temporary share. */
export type ShareId = Branded<'LfclawShareId'>
/** Identifies an employee in the enterprise directory. */
export type ShareEmployeeId = Branded<'LfclawShareEmployeeId'>
/** Attribution retained locally after the server removes a share. */
export interface ShareReceipt {
  shareId: ShareId
  senderId: ShareEmployeeId
  senderName: string
  sharedAt: number
  title: string
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Share attribution committed after the inherited history and before recipient additions. */
    'lfclaw/share-received': ShareReceipt
  }
}
