/** Compact composer references resolve current authorized expert configuration at send time. */
import type { DraftSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
/** Build a reference without putting working instructions into the editable task.
 * @param owner - Enterprise or personal ownership.
 * @param id - Expert identifier.
 * @param name - Current display name.
 * @param task - Editable task text.
 * @returns Draft with a compact expert reference.
 */
export function expertReferenceDraft(owner: 'enterprise' | 'personal', id: string, name: string, task: string): DraftSnapshot {
  const ref = JSON.stringify({ owner, id, name }), clipboardText = '@' + name
  return { text: task ? task + '\n' + clipboardText : clipboardText,
    references: [{ source: 'lfclaw-expert', ref, label: name, clipboardText, offset: task ? task.length + 1 : 0, length: clipboardText.length }] }
}
/** Decode a persisted reference, rejecting invalid ownership or identifiers.
 * @param ref - Serialized reference identity.
 * @returns Authorized request addressing fields and display name.
 */
export function parseExpertReference(ref: string): { owner: 'enterprise' | 'personal'; id: string; name: string } {
  const value: unknown = JSON.parse(ref)
  if (!value || typeof value !== 'object' || !('owner' in value) || (value.owner !== 'enterprise' && value.owner !== 'personal')
    || !('id' in value) || typeof value.id !== 'string' || !value.id || !('name' in value) || typeof value.name !== 'string')
    throw new Error('Invalid expert reference')
  return { owner: value.owner, id: value.id, name: value.name }
}
