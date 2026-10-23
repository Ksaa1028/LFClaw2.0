import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const opened = vi.fn(async () => '')
let directory = ''
vi.mock('electron', () => ({ app: { getPath: () => directory, getVersion: () => '2026.10.22-1' }, shell: { openPath: opened } }))
const { LFClawMacUpdateCoordinator } = await import('../src/lfclaw-mac-update-coordinator.ts')
const originalFetch = globalThis.fetch
afterEach(async () => {
  globalThis.fetch = originalFetch
  opened.mockClear()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('LFClaw macOS DMG updates', () => {
  it('shows a signed newer release, verifies its complete DMG, and opens it only after confirmation', async () => {
    directory = await mkdtemp(join(tmpdir(), 'lfclaw-mac-update-'))
    const keys = generateKeyPairSync('ed25519')
    const bytes = Buffer.from('DMG test fixture')
    const filename = 'LFClaw-2026102301-mac-arm64.dmg'
    const payload = { version: '2026.10.23-1', files: [{ url: filename, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }] }
    const feed = { ...payload, lfclawSignature: sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64') }
    globalThis.fetch = vi.fn(async url => new Response(String(url).endsWith('nightly.yml') ? JSON.stringify(feed) : bytes)) as typeof fetch
    const states: string[] = []
    const updater = new LFClawMacUpdateCoordinator((state) => { states.push(state.phase); return state }, async () => true,
      'https://updates.example.com/lfclaw-updates/mac-arm64/', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())
    expect((await updater.check()).phase).toBe('available')
    expect((await updater.download(payload.version)).phase).toBe('ready')
    expect(await readFile(join(directory, 'lfclaw-mac-updates', filename))).toEqual(bytes)
    expect((await updater.install(payload.version)).phase).toBe('ready')
    expect(opened).toHaveBeenCalledOnce()
    expect(states).toContain('verifying')
    updater.dispose()
  })

  it('does not open a DMG whose bytes differ from the signed feed', async () => {
    directory = await mkdtemp(join(tmpdir(), 'lfclaw-mac-update-'))
    const keys = generateKeyPairSync('ed25519')
    const payload = { version: '2026.10.23-1', files: [{ url: 'LFClaw-2026102301-mac-arm64.dmg', sha512: createHash('sha512').update('expected').digest('base64'), size: 8 }] }
    const feed = { ...payload, lfclawSignature: sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64') }
    globalThis.fetch = vi.fn(async url => new Response(String(url).endsWith('nightly.yml') ? JSON.stringify(feed) : 'modified')) as typeof fetch
    const updater = new LFClawMacUpdateCoordinator(state => state, async () => true,
      'https://updates.example.com/lfclaw-updates/mac-arm64/', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())
    expect((await updater.check()).phase).toBe('available')
    expect((await updater.download(payload.version)).phase).toBe('error')
    expect(opened).not.toHaveBeenCalled()
    updater.dispose()
  })
})
