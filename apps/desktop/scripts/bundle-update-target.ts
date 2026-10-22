/** Pack one validated Desktop update target for a single-file deployment handoff. */

import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DesktopPackageTargetName } from './package-target.ts'
import { createDesktopUploadPlan, type DesktopUploadPlan } from './desktop-upload-plan.ts'
import { loadDesktopPackageEnvironment } from './desktop-package-environment.mjs'

const TARGETS = new Set<DesktopPackageTargetName>(['mac-arm64', 'mac-x64', 'win-x64'])

function safeKey(key: string): string {
  if (key.startsWith('/') || key.includes('\\') || key.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`desktop update bundle: unsafe object key ${JSON.stringify(key)}`)
  }
  return key
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

/**
 * Create one archive containing the validated files and their final public object keys.
 * The archive is an operator handoff; extraction and activation belong to the deployment service.
 * @param plan Validated update plan, including rewritten channel metadata.
 * @param outputPath New archive path, which must not already exist.
 * @returns Absolute archive path after writing all bytes.
 */
export async function bundleDesktopUpdate(plan: DesktopUploadPlan, outputPath: string): Promise<string> {
  const output = resolve(outputPath)
  const staging = await mkdtemp(join(tmpdir(), 'dsh-update-bundle-'))
  const pending = `${output}.pending-${randomUUID()}`
  try {
    const files = []
    const keys = new Set<string>()
    for (const artifact of plan.artifacts) {
      const key = safeKey(artifact.key)
      if (keys.has(key)) throw new Error(`desktop update bundle: duplicate object key ${key}`)
      keys.add(key)
      const path = join(staging, 'objects', ...key.split('/'))
      await mkdir(dirname(path), { recursive: true })
      if (artifact.contents === undefined) await copyFile(artifact.path, path)
      else await writeFile(path, artifact.contents)
      files.push({ key, size: (await stat(path)).size, sha512: await sha512(path),
        channelMetadata: artifact.channelMetadata })
    }
    if (files.at(-1)?.channelMetadata !== true) {
      throw new Error('desktop update bundle: channel metadata must be the last object')
    }
    await writeFile(join(staging, 'release.json'), `${JSON.stringify({ schemaVersion: 1, product: 'LFClaw',
      environment: plan.environment, target: plan.target, version: plan.version,
      publicUrl: plan.publicUrl, files }, null, 2)}\n`)
    await mkdir(dirname(output), { recursive: true })
    execFileSync('tar', ['-czf', pending, '-C', staging, '.'], { stdio: 'pipe' })
    await copyFile(pending, output, constants.COPYFILE_EXCL)
    return output
  } finally {
    await rm(pending, { force: true })
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const target = process.argv[2]
  if (target === undefined || !TARGETS.has(target as DesktopPackageTargetName) || process.argv.length !== 3) {
    throw new Error('desktop update bundle: expected one target: mac-arm64, mac-x64, or win-x64')
  }
  const selected = target as DesktopPackageTargetName
  const environment = loadDesktopPackageEnvironment(selected === 'win-x64' ? 'win32' : 'darwin')
  const bucketName = environment.DSH_DESKTOP_AUTO_UPDATE_ENV === 'production'
    ? 'DOWNLOAD_PROD_COS_BUCKET' : 'DOWNLOAD_TEST_COS_BUCKET'
  const plan = await createDesktopUploadPlan(selected, { environment: {
    ...environment, [bucketName]: environment[bucketName] || 'local-bundle-only',
  } })
  const path = join(import.meta.dirname, '..', '.desktop-build', 'release-bundles',
    `${plan.target}-${plan.version}.tar.gz`)
  process.stdout.write(`${await bundleDesktopUpdate(plan, path)}\n`)
}
