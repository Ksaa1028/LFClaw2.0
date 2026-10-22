import { expect, it } from 'vitest'
import { EnterpriseOAuthRelay } from '../src/enterprise-oauth.ts'

it('replaces a pending browser callback and closes listeners on disposal', async () => {
  const callbacks: string[] = []
  const relay = new EnterpriseOAuthRelay(
    async (_path, init) => {
      const body = JSON.parse(String(init.body)) as { callbackUrl: string }
      callbacks.push(body.callbackUrl)
      return Response.json({ authorizationUrl: 'https://auth.example/authorize', state: 'a'.repeat(43) })
    },
    2000,
    60000,
  )
  try {
    expect((await relay.start('notion', 'config', new AbortController().signal)).status).toBe(200)
    expect((await relay.start('notion', 'config', new AbortController().signal)).status).toBe(200)
    await expect(fetch(callbacks[0]!, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
    expect((await fetch(callbacks[1]!, { signal: AbortSignal.timeout(2000) })).status).toBe(400)
  } finally {
    await relay.dispose()
  }
  await expect(fetch(callbacks[1]!, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
  await expect(relay.start('notion', 'config', new AbortController().signal)).rejects.toThrow('disposed')
})

it('drains a pending enterprise request when the Host is disposed', async () => {
  const entered = Promise.withResolvers<void>()
  let callback = ''
  const relay = new EnterpriseOAuthRelay(
    async (_path, init) => {
      callback = (JSON.parse(String(init.body)) as { callbackUrl: string }).callbackUrl
      entered.resolve()
      return await new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          'abort',
          () => {
            reject(init.signal!.reason)
          },
          { once: true },
        )
      })
    },
    2000,
    60000,
  )
  const start = relay.start('notion', 'config', new AbortController().signal)
  const rejected = expect(start).rejects.toThrow()
  await entered.promise
  await relay.dispose()
  await rejected
  await expect(fetch(callback, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
})

it('sanitizes an old enterprise server rejection and releases its listener', async () => {
  let callback = ''
  const relay = new EnterpriseOAuthRelay(
    async (_path, init) => {
      callback = (JSON.parse(String(init.body)) as { callbackUrl: string }).callbackUrl
      return Response.json({ code: 'ACCOUNT_INVALID', internal: 'private' }, { status: 400 })
    },
    2000,
    60000,
  )
  try {
    const result = await relay.start('notion', 'config', new AbortController().signal)
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ code: 'OAUTH_SERVER_UPDATE_REQUIRED' })
  } finally {
    await relay.dispose()
  }
  await expect(fetch(callback, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
})
