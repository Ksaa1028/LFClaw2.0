/** Map an operator release ID to the SemVer version used by electron-updater. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateDesktopBuildVersion } from './desktop-build-version.mjs'

/**
 * Resolve a YYYYMMDDxx release ID to a Desktop build version.
 * @param {string} releaseId Operator-facing release ID.
 * @param {string} productVersion Version declared by the Desktop package.
 * @returns {string} Version accepted by the Desktop packager and updater.
 */
export function desktopVersionForReleaseId(releaseId, productVersion) {
  if (!/^\d{8}(0[1-9]|[1-9]\d)$/u.test(releaseId)) {
    throw new Error('release ID must use YYYYMMDDxx with xx from 01 to 99')
  }
  const year = Number(releaseId.slice(0, 4))
  const month = Number(releaseId.slice(4, 6))
  const day = Number(releaseId.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error('release ID contains an invalid calendar date')
  }
  const version = `${year}.${month}.${day}-${Number(releaseId.slice(8))}`
  return validateDesktopBuildVersion(version, productVersion)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const releaseId = process.argv[2]
  if (releaseId === undefined || process.argv.length !== 3) {
    throw new Error('usage: node lfclaw-release-id.mjs YYYYMMDDxx')
  }
  const product = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))
  process.stdout.write(`${desktopVersionForReleaseId(releaseId, product.version)}\n`)
}
