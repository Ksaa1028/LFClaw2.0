import { describe, expect, it, vi } from 'vitest'
import { EnterpriseActivation, enterpriseUrl, type ActivationStorage } from '../src/enterprise.ts'
const server = 'http://127.0.0.1:39811/lfclaw/api'
function fixture() {
  let saved: unknown
  const storage: ActivationStorage = {
    read: async () => saved,
    write: async (value) => {
      saved = value
    },
    clear: async () => {
      saved = undefined
    },
  }
  const transport = vi.fn<typeof fetch>()
  const service = new EnterpriseActivation(server, 1000, storage, transport)
  const request = (operation: string, code?: string) =>
    service.handle(
      new Request(
        `http://localhost/api/lfclaw/${operation}`,
        code === undefined ? {} : { method: 'POST', body: JSON.stringify({ code }) },
      ),
    )
  return { storage, transport, request }
}
describe('企业桌面激活', () => {
  it('读取公开首页文案且不传递凭据或额外字段', async () => {
    const f = fixture()
    const branding = { headline: '让想法落地', badge: '企业版', showBadge: true }
    f.transport.mockResolvedValueOnce(Response.json({ ...branding, token: 'not-for-renderer' }))
    expect(await (await f.request('branding')).json()).toEqual(branding)
    expect(f.transport.mock.calls[0]?.[0]).toBe(`${server}/branding`)
    expect(f.transport.mock.calls[0]?.[1]?.headers).toBeUndefined()
    f.transport.mockResolvedValueOnce(Response.json({ headline: 123 }))
    expect((await f.request('branding')).status).toBe(503)
    f.transport.mockResolvedValueOnce(new Response(null, { status: 500 }))
    expect((await f.request('branding')).status).toBe(503)
  })
  it('首次启动要求激活，不接受模拟凭据', async () => {
    const f = fixture()
    expect(await (await f.request('status')).json()).toEqual({ activated: false })
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('持久化凭据并重新向服务器验证，不向页面泄漏令牌', async () => {
    const f = fixture()
    f.transport
      .mockResolvedValueOnce(Response.json({ token: 'private-token' }))
      .mockResolvedValueOnce(
        Response.json({ employee: { id: '1', name: '员工', departmentName: '营运一层', activationCode: 'private-code' } }),
      )
      .mockResolvedValueOnce(Response.json({ employee: { id: '1', name: '员工', departmentName: '营运一层' } }))
    const result = await (await f.request('activate', 'valid-code')).json()
    expect(result).toEqual({ activated: true, employee: { id: '1', name: '员工', departmentName: '营运一层' } })
    expect(await f.storage.read()).toEqual({ serverUrl: server, token: 'private-token' })
    expect(await (await f.request('status')).json()).toEqual(result)
    expect(f.transport.mock.calls[2]?.[1]?.headers).toEqual({ Authorization: 'Bearer private-token' })
    await f.request('logout')
    expect(await f.storage.read()).toBeUndefined()
  })
  it('无效激活码和离线状态都不放行', async () => {
    const f = fixture()
    f.transport.mockResolvedValueOnce(new Response(null, { status: 401 }))
    expect((await f.request('activate', 'invalid')).status).toBe(401)
    expect(await f.storage.read()).toBeUndefined()
    await f.storage.write({ serverUrl: server, token: 'retained' })
    f.transport.mockRejectedValueOnce(new Error('offline'))
    expect((await f.request('status')).status).toBe(503)
    expect(await f.storage.read()).toEqual({ serverUrl: server, token: 'retained' })
  })
  it('切换服务器后不发送原服务器的凭据', async () => {
    const f = fixture()
    await f.storage.write({ serverUrl: 'https://old.example/api', token: 'old' })
    expect(await (await f.request('status')).json()).toEqual({ activated: false })
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('公网 HTTP 需要显式允许，仍拒绝凭据、查询参数及非 HTTP 协议', () => {
    for (const url of ['http://example.com/api', 'https://user:secret@example.com', 'https://example.com?key=value'])
      expect(() => enterpriseUrl(url)).toThrow()
    expect(enterpriseUrl(`${server}/`)).toBe(server)
    const production = 'http://8.216.38.213:39811/lfclaw/api'
    expect(() => enterpriseUrl(production)).toThrow()
    expect(enterpriseUrl(`${production}/`, true)).toBe(production)
    for (const url of [
      'http://user:secret@example.com',
      'http://example.com?key=value',
      'http://example.com#token',
      'ftp://example.com',
    ]) {
      expect(() => enterpriseUrl(url, true)).toThrow()
    }
  })
})
