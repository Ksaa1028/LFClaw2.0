import { createHash } from 'node:crypto'
import { vi } from 'vitest'

/** A commit wakes pending catalog requests; disposal cancels them. */
export function withCatalogWatch(handle: (path: string, init?: RequestInit) => Promise<Response>) {
  const pending = new Set<() => void>()
  return {
    notify() {
      for (const finish of [...pending]) finish()
    },
    request: vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
      if (!path.startsWith('employee/connector-catalog')) return handle(path, init)
      const read = async () => {
        const response = await handle('employee/me', init)
        if (!response.ok) return response
        const value: Record<string, unknown> = await response.json()
        return Response.json({ ...value, revision: createHash('sha256').update(JSON.stringify(value)).digest('hex') })
      }
      if (path.includes('?revision='))
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            cleanup()
            resolve()
          }
          const aborted = () => {
            cleanup()
            reject(init?.signal?.reason)
          }
          const cleanup = () => {
            pending.delete(finish)
            init?.signal?.removeEventListener('abort', aborted)
          }
          pending.add(finish)
          init?.signal?.addEventListener('abort', aborted, { once: true })
          if (init?.signal?.aborted) aborted()
        })
      return read()
    }),
  }
}
