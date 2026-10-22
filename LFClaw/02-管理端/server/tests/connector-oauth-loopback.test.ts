import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import express from 'express'
import { auth as authorize } from '@modelcontextprotocol/sdk/client/auth.js'
import { AuthService, bearerToken } from '../src/auth.ts'
import { JsonStore, type RecordItem } from '../src/store.ts'
import { accountConfiguration } from '../src/connector-account.ts'
import { ConnectorOAuth } from '../src/connector-oauth.ts'
import { mountConnectorAuthentication } from '../src/connector-auth-routes.ts'
import { EnterpriseOAuthRelay } from '../../../../packages/client/ui-enterprise-connectors/src/enterprise-oauth.ts'
import { skillArchiveLimits } from './skill-limits.ts'

test('公网 HTTP 企业服务通过员工本机回调授权，绑定身份、配置、PKCE 与一次性 state', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-loopback-'))
  const store = new JsonStore(join(directory, 'db.json'))
  const connector: RecordItem = { id: 'notion', name: 'Notion', enabled: true, type: 'mcp', scope: 'all',
    endpoint: 'https://mcp.example/mcp', transport: 'streamable-http', tools: [],
    authentication: { type: 'oauth', owner: 'employee', fields: [] } }
  store.update(db => { db.connectors.push(connector, { ...connector, id: 'other' }); db.employees = ['a', 'b'].map(id => ({ id, name: id, status: 'active' })) })
  const auth = new AuthService(join(directory, 'auth.json'), 'fixture-password', { adminMs: 60000, employeeMs: 60000 })
  const tokens = { a: auth.issue({ principal: 'employee', employeeId: 'a' }), b: auth.issue({ principal: 'employee', employeeId: 'b' }) }
  const nativeFetch = globalThis.fetch
  let redirectUrl = '', expectedChallenge = '', exchanges = 0, discoveries = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname === '127.0.0.1') return nativeFetch(input, init)
    if (url.pathname.includes('oauth-protected-resource')) return Response.json({ resource: connector.endpoint, authorization_servers: ['https://auth.example'] })
    if (url.pathname.includes('oauth-authorization-server')) return Response.json({ issuer: 'https://auth.example',
      authorization_endpoint: 'https://auth.example/authorize', token_endpoint: 'https://auth.example/token',
      registration_endpoint: 'https://auth.example/register', response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] })
    if (url.pathname === '/register') {
      const metadata = JSON.parse(String(init?.body))
      redirectUrl = metadata.redirect_uris[0]
      return Response.json({ ...metadata, client_id: 'fixture-client' }, { status: 201 })
    }
    if (url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body))
      if (body.get('grant_type') === 'authorization_code') {
        assert.equal(body.get('redirect_uri'), redirectUrl)
        assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), expectedChallenge)
      } else assert.equal(body.get('grant_type'), 'refresh_token')
      exchanges++
      return Response.json({ access_token: `fixture-access-${exchanges}`, token_type: 'Bearer', refresh_token: 'fixture-refresh', expires_in: 3600 })
    }
    throw new Error(`Unexpected OAuth fixture URL ${url.href}`)
  })
  const lifetime = new AbortController()
  const oauth = new ConnectorOAuth(store, '', 2000, 60000, lifetime.signal)
  const app = express(); app.use(express.json())
  mountConnectorAuthentication(app, { skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: directory,
    allowedOrigin: 'http://8.216.38.213:39811', modelTimeoutMs: 2000, authWindowMs: 60000, loginMaxFailures: 3, activationMaxFailures: 3 }, {
    oauth,
    employee: req => { const id = auth.resolve(bearerToken(req))?.employeeId; return store.read().employees.find(e => e.id === id && e.status === 'active') ?? null },
    discover: async (_connector, _signal, provider) => { assert(await provider?.tokens()); discoveries++; return [{ name: 'notion-search', description: 'Search' }] },
  })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert(address && typeof address !== 'string')
  const root = `http://127.0.0.1:${address.port}/api/`
  let employee: keyof typeof tokens = 'a'
  const request = (path: string, init: RequestInit) => nativeFetch(root + path, { ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${tokens[employee]}` } })
  const relay = new EnterpriseOAuthRelay(request, 2000, 60000)
  const configuration = accountConfiguration(connector)
  const complete = (state: string, id = 'notion') => request(`employee/connectors/${id}/credentials`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'oauth-complete', configuration, state, code: 'fixture-code' }) })
  try {
    const start = async () => {
      const result = await relay.start('notion', configuration, new AbortController().signal)
      assert.equal(result.status, 200)
      const url = new URL((await result.json() as { authorizationUrl: string }).authorizationUrl)
      expectedChallenge = url.searchParams.get('code_challenge')!
      assert(expectedChallenge)
      assert.match(redirectUrl, /^http:\/\/127\.0\.0\.1:\d+\/callback\/[a-f0-9]{32}$/)
      return url.searchParams.get('state')!
    }
    const state = await start()
    assert.equal((await nativeFetch(`${redirectUrl}?state=wrong&code=test`)).status, 400)
    employee = 'b'; assert.equal((await complete(state)).status, 400); employee = 'a'
    assert.equal((await complete(state, 'other')).status, 400)
    assert.equal((await nativeFetch(`${root}connectors/oauth/callback?state=${state}&code=test`)).status, 400)
    assert.equal(exchanges, 0)
    const completed = await nativeFetch(`${redirectUrl}?state=${state}&code=fixture-code`)
    assert.equal(completed.status, 200); assert.match(await completed.text(), /授权成功/)
    assert.equal(exchanges, 1); assert.equal(discoveries, 1)
    assert.equal(store.read().connectorAccounts[0]?.employeeId, 'a')
    assert.deepEqual(store.read().connectors[0]?.tools, [{ id: 'notion-search', name: 'notion-search', description: 'Search', allowed: true }])
    assert.equal((await complete(state)).status, 400)
    const reloadedStore = new JsonStore(join(directory, 'db.json'))
    const reloadedOAuth = new ConnectorOAuth(reloadedStore, '', 2000, 60000, lifetime.signal)
    const account = reloadedStore.read().connectorAccounts[0]!
    assert.equal(await authorize(reloadedOAuth.forAccount(connector, account), { serverUrl: String(connector.endpoint), fetchFn: reloadedOAuth.fetchFn }), 'AUTHORIZED')
    assert.equal(exchanges, 2)
    const previous = structuredClone(store.read().connectorAccounts)
    const stale = await start()
    store.update(db => { db.connectors[0]!.enabled = false })
    assert.equal((await nativeFetch(`${redirectUrl}?state=${stale}&code=fixture-code`)).status, 400)
    assert.deepEqual(store.read().connectorAccounts, previous)
    store.update(db => { db.connectors[0]!.enabled = true })
    const staleConfiguration = await start()
    store.update(db => { db.connectors[0]!.endpoint = 'https://mcp.example/changed' })
    assert.equal((await complete(staleConfiguration)).status, 409)
    assert.deepEqual(store.read().connectorAccounts, previous)
    await assert.rejects(oauth.start(connector, 'a', () => {}, 'http://8.216.38.213:39811/callback/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
    await assert.rejects(oauth.start(connector, 'a', () => {}, 'http://127.0.0.1:1234/other'))
    assert.equal(exchanges, 2)
  } finally {
    await relay.dispose(); lifetime.abort()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    t.mock.restoreAll()
    rmSync(directory, { recursive: true, force: true })
  }
})
