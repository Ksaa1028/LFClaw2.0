import { expect, it, vi } from 'vitest'
import { expertRequest } from '../src/proxy.ts'
it('reuses display snapshots only for lists while refresh and preparation stay fresh', async () => {
  const upstream = vi.fn().mockImplementation(async () => Response.json({ experts: [] }))
  await expertRequest(new Request('http://localhost/api/lfclaw/expert-center'), upstream, 30000)
  expect(upstream).toHaveBeenLastCalledWith('employee/me', expect.objectContaining({ catalogMaxAgeMs: 30000 }))
  await expertRequest(new Request('http://localhost/api/lfclaw/expert-center?refresh=1'), upstream, 30000)
  expect(upstream).toHaveBeenLastCalledWith('employee/me', expect.objectContaining({ catalogMaxAgeMs: 0 }))
  await expertRequest(
    new Request('http://localhost/api/lfclaw/expert-prepare', { method: 'POST', body: '{"id":"e1"}' }),
    upstream,
    30000,
  )
  expect(upstream).toHaveBeenLastCalledWith(
    'employee/experts/prepare',
    expect.not.objectContaining({ catalogMaxAgeMs: expect.anything() }),
  )
})
it('maps only known operations and encodes identifiers without accepting arbitrary upstream paths', async () => {
  const upstream = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  const response = await expertRequest(
    new Request('http://localhost/api/lfclaw/personal-experts?action=delete&id=a%2Fb', { method: 'POST' }),
    upstream,
  )
  expect(response.status).toBe(204)
  expect(upstream).toHaveBeenCalledWith('employee/personal-experts/a%2Fb', expect.objectContaining({ method: 'DELETE' }))
  expect((await expertRequest(new Request('http://localhost/api/lfclaw/unknown'), upstream)).status).toBe(400)
  expect(upstream).toHaveBeenCalledTimes(1)
})
it('retains upstream authorization failures and reports unknown mutation outcomes', async () => {
  expect(
    (
      await expertRequest(
        new Request('http://localhost/api/lfclaw/expert-center'),
        vi.fn().mockResolvedValue(Response.json({ code: 'UNAUTHORIZED' }, { status: 401 })),
      )
    ).status,
  ).toBe(401)
  const response = await expertRequest(
    new Request('http://localhost/api/lfclaw/personal-experts?action=delete&id=p1', { method: 'POST' }),
    vi.fn().mockRejectedValue(new Error('network')),
  )
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ code: 'EXPERT_CONNECTION_FAILED' })
})
