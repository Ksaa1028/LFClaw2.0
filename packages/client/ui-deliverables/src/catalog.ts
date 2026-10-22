/** Cross-session directory of explicitly presented files. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-api-workspace-files'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { isPresentedData, isPresentedFile } from './presented.ts'
import { catalogRemoval, catalogRemovalDomain, catalogRemovalKey } from './catalog-removals.ts'
import { PRESENT_CATALOG_PATH } from './catalog-route.ts'

export { PRESENT_CATALOG_PATH } from './catalog-route.ts'

/** One original declaration, kept distinct from later declarations of the same path. */
export interface CatalogFile {
  sessionId: SessionId
  cwd?: string
  seq: number
  index: number
  time: number
  path: string
  description?: string
  availability: 'available' | 'missing' | 'error'
}

/** A page of matching deliveries and the number of sessions that could not be read. */
export interface CatalogPage {
  files: CatalogFile[]
  total: number
  unreadableSessions: number
}

const PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100
const READ_CONCURRENCY = 4

interface CatalogIndex {
  read: () => Promise<{ files: Omit<CatalogFile, 'availability'>[]; unreadableSessions: number }>
  invalidate: () => void
}

/** Register catalog reads and confirmed record removal under Connection's authenticated routes.
 * @param ctx - Host plugin context.
 */
export async function registerPresentCatalog(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(catalogRemovalDomain)
  const lifetime = new AbortController()
  const pending = new Set<Promise<Response>>()
  const index = createCatalogIndex(ctx, lifetime.signal)
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'deliverables/presented') index.invalidate()
  })
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(pending)
    await domain.close()
  })
  ctx.connection.fetch.register({
    path: PRESENT_CATALOG_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: (request) => {
      const scoped = new Request(request, {
        signal: AbortSignal.any([request.signal, lifetime.signal]),
      })
      const task =
        scoped.method === 'POST' ? removeCatalogRecord(index, domain, scoped) : catalogResponse(ctx, index, domain, scoped)
      pending.add(task)
      void task.then(
        () => {
          pending.delete(task)
        },
        () => {
          pending.delete(task)
        },
      )
      return task
    },
  })
}

function createCatalogIndex(ctx: Context, signal: AbortSignal): CatalogIndex {
  let generation = 0
  let cached: Promise<{ files: Omit<CatalogFile, 'availability'>[]; unreadableSessions: number }> | undefined
  return {
    invalidate: () => {
      generation++
      cached = undefined
    },
    read: async () => {
      for (;;) {
        const version = generation
        let scan = cached
        if (scan === undefined) {
          scan = scanCatalog(ctx, signal)
          cached = scan
          void scan.catch(() => {
            if (cached === scan) cached = undefined
          })
        }
        const result = await scan
        if (version === generation) return result
      }
    },
  }
}

function integer(value: string | null, fallback: number, maximum: number): number | undefined {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined
}

async function removeCatalogRecord(
  index: CatalogIndex,
  domain: Domain<typeof catalogRemovalDomain>,
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch (_error) {
    return new Response('Invalid catalog file.', { status: 400 })
  }
  const parsed = catalogRemoval.safeParse(body)
  if (!parsed.success) return new Response('Invalid catalog file.', { status: 400 })
  try {
    const key = catalogRemovalKey(parsed.data)
    if (domain.table('removed').get(key) !== undefined) return new Response(null, { status: 204 })
    const snapshot = await index.read()
    request.signal.throwIfAborted()
    if (
      !snapshot.files.some(
        file => file.sessionId === parsed.data.sessionId && file.seq === parsed.data.seq && file.index === parsed.data.index,
      )
    )
      return new Response('Catalog file changed.', { status: 409 })
    await domain.table('removed').put(key, parsed.data)
    return new Response(null, { status: 204 })
  } catch (error: unknown) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    console.error('present catalog: could not remove record', error)
    return new Response('Could not remove catalog file.', { status: 500 })
  }
}

async function catalogResponse(
  ctx: Context,
  index: CatalogIndex,
  domain: Domain<typeof catalogRemovalDomain>,
  request: Request,
): Promise<Response> {
  const params = new URL(request.url).searchParams
  const offset = integer(params.get('offset'), 0, Number.MAX_SAFE_INTEGER)
  const limit = integer(params.get('limit'), PAGE_SIZE, MAX_PAGE_SIZE)
  if (offset === undefined || limit === undefined || limit === 0) return new Response('Invalid catalog page.', { status: 400 })
  const query = (params.get('q') ?? '').trim().toLocaleLowerCase()
  if (query.length > 256) return new Response('Search is too long.', { status: 400 })
  const refresh = params.get('refresh')
  if (refresh !== null && refresh !== '1') return new Response('Invalid refresh option.', { status: 400 })
  try {
    if (refresh === '1') index.invalidate()
    const snapshot = await index.read()
    request.signal.throwIfAborted()
    const visible = snapshot.files.filter(file => domain.table('removed').get(catalogRemovalKey(file)) === undefined)
    const matches =
      query === ''
        ? visible
        : visible.filter(file =>
          `${file.path}\n${file.description ?? ''}\n${file.cwd ?? ''}`.toLocaleLowerCase().includes(query),
        )
    const page = matches.slice(offset, offset + limit)
    const checked = await Promise.all(
      page.map(async (file): Promise<CatalogFile> => {
        try {
          await ctx.workspaceFiles.stat(
            { sessionId: file.sessionId, workspaceRoot: file.cwd ?? ctx.sandboxPolicy.workspaceRoot },
            file.path,
            request.signal,
          )
          return { ...file, availability: 'available' }
        } catch (error: unknown) {
          request.signal.throwIfAborted()
          const code = remoteErrorOf(error)?.code ?? (error instanceof Error && 'code' in error ? error.code : undefined)
          const missing =
            code === 'ENOENT' ||
            code === 'ENOTDIR' ||
            code === 'workspace-file/not-found' ||
            code === 'workspace-file/not-regular-file'
          return { ...file, availability: missing ? 'missing' : 'error' }
        }
      }),
    )
    return Response.json(
      { files: checked, total: matches.length, unreadableSessions: snapshot.unreadableSessions } satisfies CatalogPage,
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error: unknown) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    console.error('present catalog: could not list deliveries', error)
    return new Response('Could not list delivered files.', { status: 500 })
  }
}

async function scanCatalog(
  ctx: Context,
  signal: AbortSignal,
): Promise<{ files: Omit<CatalogFile, 'availability'>[]; unreadableSessions: number }> {
  const sessions = await ctx.sessionQuery.listSessions(signal)
  const files: Omit<CatalogFile, 'availability'>[] = []
  let unreadableSessions = 0
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, sessions.length) }, async () => {
      while (cursor < sessions.length) {
        signal.throwIfAborted()
        const session = sessions[cursor++]
        if (session === undefined) break
        try {
          const snapshot = await ctx.sessionQuery.observeSession(session.header.id, { signal, projectionMode: 'none' })
          try {
            signal.throwIfAborted()
            for (const event of snapshot.events.slice(snapshot.inheritedEventCount)) {
              if (event.type !== 'deliverables/presented' || !isPresentedData(event.data)) continue
              event.data.files.forEach((value, index) => {
                if (!isPresentedFile(value)) return
                files.push({
                  sessionId: snapshot.header.id,
                  ...(snapshot.header.cwd === undefined ? {} : { cwd: snapshot.header.cwd }),
                  seq: event.seq,
                  index,
                  time: event.time,
                  path: value.path,
                  ...(value.description === undefined ? {} : { description: value.description }),
                })
              })
            }
          } finally {
            snapshot[Symbol.dispose]()
          }
        } catch (error: unknown) {
          signal.throwIfAborted()
          unreadableSessions++
          console.warn(`present catalog: could not read Session ${session.header.id}: ${String(error)}`)
        }
      }
    }),
  )
  files.sort((a, b) => b.time - a.time || b.seq - a.seq || a.sessionId.localeCompare(b.sessionId) || a.index - b.index)
  return { files, unreadableSessions }
}
