/** Clear local employee credentials before reloading the activation gate.
 * @param reload - Reload the client after confirmed credential removal.
 * @returns Resolves after requesting reload; rejects on an unconfirmed sign-out.
 */
export async function signOutEmployee(reload: () => void): Promise<void> {
  const response = await fetch('/api/lfclaw/logout', { method: 'POST' })
  if (!response.ok) throw new Error('Employee sign-out failed')
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || !('activated' in value) || value.activated !== false) {
    throw new Error('Employee sign-out was not confirmed')
  }
  reload()
}
