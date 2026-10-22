/** Opt-in Notion registration check; never approves consent or reads workspace data. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConnectorOAuth } from '../src/connector-oauth.ts'
import { JsonStore, type RecordItem } from '../src/store.ts'

test('Notion accepts a desktop loopback redirect while enterprise OAuth has no public callback',
  { skip: process.env.LFCLAW_TEST_NOTION_OAUTH !== '1', timeout: 60000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lfclaw-notion-oauth-'))
    const lifetime = new AbortController()
    try {
      const store = new JsonStore(join(directory, 'db.json'))
      const connector: RecordItem = { id: 'notion', name: 'Notion', enabled: true, type: 'mcp', scope: 'all',
        endpoint: 'https://mcp.notion.com/mcp', transport: 'streamable-http', tools: [],
        authentication: { type: 'oauth', owner: 'employee', fields: [] } }
      store.update(db => { db.connectors.push(connector) })
      const oauth = new ConnectorOAuth(store, '', 15000, 60000, lifetime.signal)
      const callback = 'http://127.0.0.1:49152/callback/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const result = await oauth.start(connector, 'fixture-employee', () => {}, callback)
      const url = new URL(result.authorizationUrl)
      assert.equal(url.protocol, 'https:')
      assert.equal(url.searchParams.get('redirect_uri'), callback)
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      assert.equal(url.searchParams.get('state'), result.state)
      assert(url.searchParams.get('client_id'))
      assert.equal(store.read().connectorAccounts.length, 0)
    } finally {
      lifetime.abort()
      rmSync(directory, { recursive: true, force: true })
    }
  })
