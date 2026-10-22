import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyLFClawUpdate } from '../src/lfclaw-update-signature.ts'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const payload = {
  version: '2026.10.21-9',
  files: [{ url: 'LFClaw-2026102109-windows-x64.exe', sha512: Buffer.alloc(64).toString('base64'), size: 123 }],
}
const feed = { ...payload, lfclawSignature: sign(null, Buffer.from(JSON.stringify(payload)), keys.privateKey).toString('base64') }

describe('LFClaw signed update feed', () => {
  it('accepts a release signed by the embedded key', () => {
    expect(() => {
      verifyLFClawUpdate(feed, publicKey)
    }).not.toThrow()
  })
  it.each([
    { ...feed, version: '2026.10.22-1' },
    { ...feed, files: [{ ...payload.files[0], size: 124 }] },
    { ...feed, files: [{ ...payload.files[0], url: 'https://download.deepseek.com/other.exe' }] },
    { ...feed, packages: {} },
    { ...payload },
  ])('rejects changed or unsigned metadata', (value) => {
    expect(() => {
      verifyLFClawUpdate(value, publicKey)
    }).toThrow()
  })
})
