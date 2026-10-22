import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { EnterpriseConnection } from '../src/connection.ts'
import type { ActivationStorage } from '../src/enterprise.ts'

const server = 'https://enterprise.example/api'
const display = { catalogMaxAgeMs: 30000 }
function fixture() {
  let saved: unknown = { serverUrl: server, token: 'employee-a' }
  const storage: ActivationStorage = {
    read: async () => saved,
    write: async (value) => {
      saved = value
    },
    clear: async () => {
      saved = undefined
    },
  }
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ version: 'current' }))
  vi.stubGlobal('fetch', transport)
  return { storage, transport, connection: new EnterpriseConnection(new Context(), server, 1000, storage) }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([
  ['employee/personal-experts', 'POST'],
  ['employee/personal-experts/e1', 'PUT'],
  ['employee/personal-experts/e1', 'DELETE'],
  ['employee/personal-expert-teams', 'POST'],
])('invalidates expert display snapshots after %s %s', async (path, method) => {
  const f = fixture()
  await f.connection.request('employee/me')
  await f.connection.request(path, { method })
  await f.connection.request('employee/me', display)
  expect(f.transport).toHaveBeenCalledTimes(3)
})

it('reuses a background directory response for display while authorization requests stay fresh', async () => {
  const f = fixture()
  await f.connection.request('employee/me')
  expect(await (await f.connection.request('employee/me', display)).json()).toEqual({ version: 'current' })
  expect(f.transport).toHaveBeenCalledTimes(1)
  await f.connection.request('employee/me')
  expect(f.transport).toHaveBeenCalledTimes(2)
  await f.connection.request('employee/connectors/c/tools', display)
  await f.connection.request('employee/connectors/c/tools', display)
  expect(f.transport).toHaveBeenCalledTimes(4)
})

it('expires display snapshots and always sends revision watches to the server', async () => {
  const f = fixture()
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  await f.connection.request('employee/connector-catalog')
  now.mockReturnValue(31000)
  await f.connection.request('employee/connector-catalog', display)
  f.transport.mockResolvedValueOnce(Response.json({ version: 'changed' }))
  await f.connection.request('employee/connector-catalog?revision=old', display)
  expect(await (await f.connection.request('employee/connector-catalog', display)).json()).toEqual({ version: 'changed' })
  expect(f.transport).toHaveBeenCalledTimes(3)
})

it('drops snapshots on account changes, logout, and server changes', async () => {
  const f = fixture()
  await f.connection.request('employee/me')
  await f.storage.write({ serverUrl: server, token: 'employee-b' })
  await f.connection.request('employee/me', display)
  expect(new Headers(f.transport.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer employee-b')
  await f.storage.clear()
  expect((await f.connection.request('employee/me', display)).status).toBe(401)
  await f.storage.write({ serverUrl: 'https://other.example/api', token: 'employee-b' })
  expect((await f.connection.request('employee/me', display)).status).toBe(401)
  expect(f.transport).toHaveBeenCalledTimes(2)
})

it.each([401, 403, 503])('does not retain a directory after an HTTP %s response', async (status) => {
  const f = fixture()
  await f.connection.request('employee/me')
  f.transport.mockResolvedValueOnce(new Response(null, { status }))
  await f.connection.request('employee/me')
  await f.connection.request('employee/me', display)
  expect(f.transport).toHaveBeenCalledTimes(3)
})

it('invalidates failed synchronization and rejects cancelled display reads', async () => {
  const f = fixture()
  await f.connection.request('employee/me')
  f.transport.mockRejectedValueOnce(new Error('offline'))
  await expect(f.connection.request('employee/me')).rejects.toThrow('offline')
  await f.connection.request('employee/me', display)
  await expect(f.connection.request('employee/me', { ...display, signal: AbortSignal.abort() })).rejects.toThrow()
  expect(f.transport).toHaveBeenCalledTimes(3)
})

it('does not let delayed reads overwrite a newer directory', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<Response>()
  f.transport.mockReturnValueOnce(pending.promise)
  const old = f.connection.request('employee/me')
  await vi.waitFor(() => {
    expect(f.transport).toHaveBeenCalledTimes(1)
  })
  await f.connection.request('employee/me')
  pending.resolve(Response.json({ version: 'old' }))
  await old
  expect(await (await f.connection.request('employee/me', display)).json()).toEqual({ version: 'current' })
  expect(f.transport).toHaveBeenCalledTimes(2)
})

it('invalidates snapshots across account mutations without background inventory reports evicting them', async () => {
  const f = fixture()
  await f.connection.request('employee/me')
  await f.connection.request('employee/skills/personal', { method: 'POST' })
  await f.connection.request('employee/me', display)
  expect(f.transport).toHaveBeenCalledTimes(2)
  const pending = Promise.withResolvers<Response>()
  f.transport.mockReturnValueOnce(pending.promise)
  const mutation = f.connection.request('employee/connectors/c/credentials', { method: 'PUT' })
  await vi.waitFor(() => {
    expect(f.transport).toHaveBeenCalledTimes(3)
  })
  await f.connection.request('employee/me', display)
  pending.resolve(Response.json({ ok: true }))
  await mutation
  await f.connection.request('employee/me', display)
  expect(f.transport).toHaveBeenCalledTimes(5)
})
