/** Expert center uses authenticated Host routes; employee tokens never enter the browser. */
export interface ExpertCapabilities {
  kind?: 'expert' | 'team'
  memberIds?: string[]
  skillIds?: string[]
  connectorIds?: string[]
  quickPrompts?: string[]
}
/** Employee-owned expert configuration. */
export interface PersonalExpert extends ExpertCapabilities {
  id: string
  name: string
  description: string
  instructions: string
  tags: string[]
}
/** Authorized enterprise expert; external credentials are omitted. */
export interface EnterpriseExpert extends ExpertCapabilities {
  id: string
  name: string
  description: string
  instructions?: string
  source: 'dsh' | 'bailian' | 'dify' | 'weknora' | 'external' | 'team'
  tags: string[]
}
/** Authorized enterprise capability. */
export interface ExpertResource {
  id: string
  name: string
}
/** Current employee's expert and capability catalog. */
export interface ExpertCatalog {
  experts: EnterpriseExpert[]
  personalExperts: PersonalExpert[]
  skills: ExpertResource[]
  connectors: ExpertResource[]
}
/** Immutable launch definition returned after current authorization checks. */
export interface PreparedExpert {
  name: string
  instructions: string
  members: Array<{ name: string; instructions: string }>
  skills: ExpertResource[]
  connectors: ExpertResource[]
  remote?: { id: string; source: 'bailian' | 'dify' | 'weknora' }
}
async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/lfclaw/' + path, {
    method,
    ...(signal ? { signal } : {}),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null)
    const message =
      value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
        ? value.message
        : String(response.status)
    throw new Error(message)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
/** Read authorized experts and dependencies.
 * @param fresh - Bypass the display snapshot for explicit refresh.
 * @returns Current employee catalog.
 */
export function loadExperts(fresh = false): Promise<ExpertCatalog> {
  return request(fresh ? 'expert-center?refresh=1' : 'expert-center')
}
/** Expert and team options contain no working instructions or dependency definitions. */
export interface ExpertPickerCatalog {
  experts: Pick<EnterpriseExpert, 'id' | 'name' | 'description' | 'source' | 'kind'>[]
  personalExperts: Pick<PersonalExpert, 'id' | 'name' | 'description' | 'kind'>[]
}
/** Read current authorized expert and team options.
 * @param signal - Cancellation when the picker closes.
 * @returns Lightweight enterprise and personal options.
 */
export function loadExpertPicker(signal: AbortSignal): Promise<ExpertPickerCatalog> {
  return request('expert-center?view=picker', 'GET', undefined, signal)
}
/** Delete an owned expert. @param id - Personal expert identifier. @returns Completion. */
export function deletePersonalExpert(id: string): Promise<void> {
  return request(`personal-experts?action=delete&id=${encodeURIComponent(id)}`, 'POST')
}
/** Recheck permission before preparing a chat.
 * @param owner - Resource ownership.
 * @param id - Selected expert.
 * @returns Launch definition.
 */
export function prepareExpert(owner: 'enterprise' | 'personal', id: string): Promise<PreparedExpert> {
  return request('expert-prepare', 'POST', { owner, id })
}
