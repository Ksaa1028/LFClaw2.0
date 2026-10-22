/** Explicit expert-management skill reference for create and edit conversations. */
import type { DraftSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { EXPERT_MANAGER_SKILL } from '../manager-name.ts'

/** Build a draft that loads the management skill when the user sends it.
 * @param kind - Single expert or team.
 * @param t - Localized draft instructions and chip label.
 * @param expert - Existing personal expert to edit.
 * @returns Recoverable draft with an explicit skill reference.
 */
export function expertManagerDraft(kind: 'expert' | 'team', t: TranslateNS<'lfclaw'>,
  expert?: { id: string; name: string }): DraftSnapshot {
  const ref = `/${EXPERT_MANAGER_SKILL}`
  return { text: `${ref} ${expert ? t('editPrompt', expert) : t(kind === 'team' ? 'createTeamPrompt' : 'createPrompt')}`,
    references: [{ source: 'skill', ref, label: t('managerSkill'), clipboardText: ref, offset: 0, length: ref.length }] }
}
