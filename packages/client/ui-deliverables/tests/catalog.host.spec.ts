/** The authenticated catalog reads original declarations across cold Sessions. */
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { afterEach, expect, it, vi } from 'vitest'
import { registerPresentCatalog, PRESENT_CATALOG_PATH, type CatalogPage } from '../src/catalog.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function fixture(unreadable?: SessionId, olderDeliveries = 1) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const older = SessionId('older')
  const newer = SessionId('newer')
  const listed = [older, newer].map(id => ({ header: { id } }))
  const delivery = (seq: number, time: number, path: string, description: string) => ({
    type: 'deliverables/presented',
    seq,
    time,
    data: { turn: 1, callId: `call-${seq}`, files: [{ path, description }] },
  })
  const disposed = vi.fn()
  const observeSession = vi.fn(async (id: SessionId, _options?: { signal?: AbortSignal; projectionMode?: string }) => {
    if (id === unreadable) throw new Error('Unreadable Session')
    const snapshot =
      id === older
        ? {
          header: { id, cwd: '/work/older' },
          inheritedEventCount: 0,
          events: Array.from({ length: olderDeliveries }, (_, index) =>
            delivery(index, 10 + index, `/work/older/report-${index}.docx`, 'Quarterly report'),
          ),
        }
        : {
          header: { id, cwd: '/work/newer' },
          inheritedEventCount: 1,
          events: [delivery(0, 10, '/work/older/report.docx', 'Inherited'), delivery(1, 20, '/work/newer/chart.png', 'Chart')],
        }
    return { ...snapshot, [Symbol.dispose]: disposed }
  })
  const stat = vi.fn(async (_scope: unknown, path: string) => {
    if (path.endsWith('report-0.docx')) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    return { absolutePath: path }
  })
  const listSessions = vi.fn(async () => listed)
  const removed = new Map<string, { sessionId: string; seq: number; index: number }>()
  ctx.provide('sessionQuery', { listSessions, observeSession } as never)
  ctx.provide('workspaceFiles', { stat } as never)
  ctx.provide('sandboxPolicy', { workspaceRoot: '/work' } as never)
  ctx.provide('storageDomain', {
    open: async () => ({
      table: () => ({
        get: (key: string) => removed.get(key),
        put: async (key: string, value: { sessionId: string; seq: number; index: number }) => {
          removed.set(key, value)
        },
      }),
      close: async () => {},
    }),
  } as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  await ctx.plugin({
    inject: ['connection', 'sessionQuery', 'workspaceFiles', 'sandboxPolicy', 'storageDomain'],
    apply: registerPresentCatalog,
  })
  const handler = connection.createSharedFetchHandler('/api')
  const get = async (query = ''): Promise<CatalogPage> => {
    const response = await handler.fetch(new Request(`http://localhost${PRESENT_CATALOG_PATH}${query}`))
    expect(response.status).toBe(200)
    return response.json() as Promise<CatalogPage>
  }
  return { ctx, get, listSessions, observeSession, disposed, stat, handler, removed }
}

it('lists original deliveries newest first and marks missing source files', async () => {
  const { get, observeSession, disposed, stat } = await fixture()
  const page = await get()
  expect(page).toMatchObject({ total: 2, unreadableSessions: 0 })
  expect(page.files.map(file => [file.sessionId, file.path, file.availability])).toEqual([
    ['newer', '/work/newer/chart.png', 'available'],
    ['older', '/work/older/report-0.docx', 'missing'],
  ])
  expect(observeSession).toHaveBeenCalledTimes(2)
  expect(observeSession.mock.calls[0]?.[1]).toMatchObject({ projectionMode: 'none' })
  expect(disposed).toHaveBeenCalledTimes(2)
  expect(stat).toHaveBeenCalledTimes(2)
})

it('searches the complete catalog before paging and rejects invalid limits', async () => {
  const { get, listSessions, observeSession, handler } = await fixture()
  expect((await get('?q=quarterly&limit=1')).files.map(file => file.path)).toEqual(['/work/older/report-0.docx'])
  expect((await get('?offset=1&limit=1')).files.map(file => file.path)).toEqual(['/work/older/report-0.docx'])
  expect(listSessions).toHaveBeenCalledTimes(1)
  expect(observeSession).toHaveBeenCalledTimes(2)
  expect((await get('?refresh=1')).files).toHaveLength(2)
  expect(listSessions).toHaveBeenCalledTimes(2)
  expect(observeSession).toHaveBeenCalledTimes(4)
  expect((await handler.fetch(new Request(`http://localhost${PRESENT_CATALOG_PATH}?limit=101`))).status).toBe(400)
})

it('keeps readable deliveries and reports an unreadable Session', async () => {
  const { get } = await fixture(SessionId('older'))
  const page = await get()
  expect(page).toMatchObject({ total: 1, unreadableSessions: 1 })
  expect(page.files.map(file => file.path)).toEqual(['/work/newer/chart.png'])
})

it('returns ten files per page without rescanning the corpus', async () => {
  const { get, listSessions, observeSession, stat } = await fixture(undefined, 12)
  const first = await get()
  const second = await get('?offset=10')
  expect(first).toMatchObject({ total: 13 })
  expect(first.files).toHaveLength(10)
  expect(second.files).toHaveLength(3)
  expect(listSessions).toHaveBeenCalledTimes(1)
  expect(observeSession).toHaveBeenCalledTimes(2)
  expect(stat).toHaveBeenCalledTimes(13)
})

it('rescans after a live delivery event', async () => {
  const { ctx, get, observeSession } = await fixture()
  await get()
  const session = Session.create(SessionId('newer'))
  session.append('deliverables/presented', {
    turn: 1,
    callId: ToolCallId('later-delivery'),
    files: [{ path: '/work/newer/other.txt' }],
  })
  const event = session.snapshotEvents().at(0)
  if (event === undefined) throw new Error('Missing delivery event')
  ctx.emit('session/event', session, event)
  await get()
  expect(observeSession).toHaveBeenCalledTimes(4)
})

it('shares one corpus scan between simultaneous page requests', async () => {
  const { get, listSessions, observeSession } = await fixture()
  const [all, searched] = await Promise.all([get(), get('?q=quarterly')])
  expect(all.total).toBe(2)
  expect(searched.total).toBe(1)
  expect(listSessions).toHaveBeenCalledTimes(1)
  expect(observeSession).toHaveBeenCalledTimes(2)
})

it('checks displayed files again while reusing the delivery index', async () => {
  const { get, observeSession, stat } = await fixture()
  await get()
  stat.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }))
  const next = await get()
  expect(next.files.map(file => file.availability)).toEqual(['missing', 'missing'])
  expect(observeSession).toHaveBeenCalledTimes(2)
})

it('removes only the selected catalog declaration and keeps the source file available', async () => {
  const { get, handler, stat, removed } = await fixture()
  const first = await get()
  const target = first.files[0]!
  const response = await handler.fetch(
    new Request(`http://localhost${PRESENT_CATALOG_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: target.sessionId, seq: target.seq, index: target.index }),
    }),
  )
  expect(response.status).toBe(204)
  expect((await get()).files.map(file => file.path)).toEqual(['/work/older/report-0.docx'])
  expect(removed.size).toBe(1)
  expect(stat).toHaveBeenCalledWith(expect.anything(), '/work/newer/chart.png', expect.anything())
  expect(
    (
      await handler.fetch(
        new Request(`http://localhost${PRESENT_CATALOG_PATH}`, {
          method: 'POST',
          body: JSON.stringify({ sessionId: 'newer', seq: 999, index: 0 }),
        }),
      )
    ).status,
  ).toBe(409)
})
