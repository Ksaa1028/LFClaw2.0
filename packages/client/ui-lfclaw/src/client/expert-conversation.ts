/** Prepare local dependencies and a recoverable expert conversation draft. */
import type { StartSessionOptions } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DraftReference } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PreparedExpert } from './api.ts'

/**
 * Check local skill loading and connector discovery before opening a conversation.
 * @param expert - Server-authorized immutable definition.
 * @param task - User's task.
 * @param t - Localized labels and model-visible instructions.
 * @param transport - Authenticated local Host transport.
 * @returns Draft containing skill references and full expert instructions; sends no model request.
 */
export async function expertConversation(expert: PreparedExpert, task: string, t: TranslateNS<'lfclaw'>,
  transport: typeof fetch = fetch): Promise<Exclude<NonNullable<StartSessionOptions['prompt']>, string>> {
  if (expert.remote) {
    let response: Response
    try { response = await transport('/api/lfclaw/expert-runtime') }
    catch { throw new Error(t('remoteToolUnavailable')) }
    if (!response.ok) throw new Error(t('remoteToolUnavailable'))
    const runtime: unknown = await response.json().catch(() => null)
    if (!runtime || typeof runtime !== 'object' || !('remoteExpert' in runtime) || runtime.remoteExpert !== true)
      throw new Error(t('remoteToolUnavailable'))
    return { text: [t('expertIdentity', { name: expert.name }), t('remoteExpertPrompt', { id: expert.remote.id }),
      ...(task ? [t('taskPrompt'), task] : [])].join('\n\n'), references: [] }
  }
  const selected: Array<{ name: string; invocation: string }> = []
  if (expert.skills.length) {
    const response = await transport('/api/lfclaw/skill-center?wait=1')
    const value: unknown = response.ok ? await response.json() : null
    if (!value || typeof value !== 'object' || !('enterprise' in value) || !Array.isArray(value.enterprise)) throw new Error(t('skillUnavailable'))
    for (const skill of expert.skills) {
      const ready: unknown = value.enterprise.find((item: unknown) => item && typeof item === 'object' && 'id' in item && item.id === skill.id)
      if (!ready || typeof ready !== 'object' || !('ready' in ready) || ready.ready !== true
        || !('invocationName' in ready) || typeof ready.invocationName !== 'string') throw new Error(t('skillUnavailable'))
      selected.push({ name: skill.name, invocation: ready.invocationName })
    }
  }
  for (const connector of expert.connectors) {
    const response = await transport(`/api/lfclaw/connector-center?id=${encodeURIComponent(connector.id)}`)
    const value: unknown = response.ok ? await response.json() : null
    if (!value || typeof value !== 'object' || !('tools' in value) || !Array.isArray(value.tools) || !value.tools.length) throw new Error(t('connectorUnavailable'))
  }
  const references: DraftReference[] = []
  let prefix = ''
  for (const skill of selected) {
    const ref = `/${skill.invocation}`
    references.push({ source: 'skill', ref, label: skill.name, clipboardText: ref, offset: prefix.length, length: ref.length })
    prefix += ref + '\n'
  }
  const text = [t(expert.members.length ? 'teamIdentity' : 'expertIdentity', { name: expert.name }),
    t('identityReply'), t('expertPrompt'), expert.instructions,
    ...(expert.members.length ? [t('teamPrompt'), ...expert.members.map((member, index) => `${index + 1}. ${member.name}\n${member.instructions}`)] : []),
    ...(expert.connectors.length ? [t('connectorPrompt'), ...expert.connectors.map(item => item.name)] : []),
    ...(task ? [t('taskPrompt'), task] : [])].join('\n\n')
  return { text: prefix + text, references }
}
