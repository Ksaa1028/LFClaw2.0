/** Durable exclusions for individual declarations in the Deliverables catalog. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Identity of one declared file, independent of its filesystem path. */
export const catalogRemoval = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  index: z.number().int().nonnegative(),
})

/** Durable catalog exclusions; source Session events and files remain intact. */
export const catalogRemovalDomain = defineDomain({
  name: 'deliverables_catalog',
  version: 1,
  tables: { removed: domainTable<string, z.infer<typeof catalogRemoval>>(catalogRemoval) },
})

/** Collision-free key for one declaration.
 * @param value - Recorded declaration coordinates.
 * @returns Stable key for the durable exclusion table.
 */
export function catalogRemovalKey(value: z.infer<typeof catalogRemoval>): string {
  return JSON.stringify([value.sessionId, value.seq, value.index])
}
