/** Authenticate LFClaw update metadata before offering or downloading an installer. */
import { verify } from 'node:crypto'

/**
 * Verify the signed version and complete installer file list; reject alternate package sources.
 * @param info - Untrusted parsed updater feed.
 * @param publicKey - PEM Ed25519 release key embedded in the installed application.
 */
export function verifyLFClawUpdate(info: unknown, publicKey: string, target: 'win-x64' | 'mac-arm64' = 'win-x64'): void {
  if (typeof info !== 'object' || info === null || !('version' in info) || typeof info.version !== 'string'
    || !('files' in info) || !Array.isArray(info.files) || info.files.length !== 1
    || !('lfclawSignature' in info) || typeof info.lfclawSignature !== 'string' || 'packages' in info) {
    throw new Error('LFClaw update metadata is incomplete or unsigned')
  }
  const files = info.files.map((file: unknown) => {
    if (typeof file !== 'object' || file === null || !('url' in file) || typeof file.url !== 'string'
      || !(target === 'win-x64' ? /^LFClaw-\d{10}-windows-x64\.exe$/ : /^LFClaw-\d{10}-mac-arm64\.dmg$/).test(file.url)
      || !('sha512' in file) || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
      || !('size' in file) || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('LFClaw update installer metadata is invalid')
    }
    return { url: file.url, sha512: file.sha512, size: file.size }
  })
  const payload = JSON.stringify({ version: info.version, files })
  if (!verify(null, Buffer.from(payload), publicKey, Buffer.from(info.lfclawSignature, 'base64'))) {
    throw new Error('LFClaw update signature verification failed')
  }
}
