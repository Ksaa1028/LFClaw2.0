import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleDesktopUpdate } from '../scripts/bundle-update-target.ts'
import type { DesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'

describe('Desktop update release bundle', () => {
  it('contains binaries, final metadata, and a release manifest in one archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bundle-test-'))
    try {
      const binary = join(root, 'installer.exe')
      const output = join(root, 'release.tar.gz')
      await writeFile(binary, 'installer bytes')
      const plan: DesktopUploadPlan = {
        environment: 'production', target: 'win-x64', version: '1.2.3',
        publicUrl: 'https://updates.example.com/dsh-desk/feeds/win-x64/',
        bucket: 'unused', secretIdEnvName: 'unused', secretKeyEnvName: 'unused',
        artifacts: [
          { path: binary, filename: 'installer.exe', key: 'dsh-desk/bin/win-x64/installer.exe',
            contentType: 'application/octet-stream', channelMetadata: false },
          { path: join(root, 'nightly.yml'), filename: 'nightly.yml', key: 'dsh-desk/feeds/win-x64/nightly.yml',
            contentType: 'application/yaml', channelMetadata: true, contents: 'version: 1.2.3\n' },
        ],
      }
      await bundleDesktopUpdate(plan, output)
      execFileSync('tar', ['-xzf', output, '-C', root])
      const release: unknown = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'))
      expect(release).toMatchObject({ product: 'LFClaw', files: [
        { key: 'dsh-desk/bin/win-x64/installer.exe', size: 15, channelMetadata: false },
        { key: 'dsh-desk/feeds/win-x64/nightly.yml', size: 15, channelMetadata: true },
      ] })
      expect(await readFile(join(root, 'objects', 'dsh-desk', 'feeds', 'win-x64', 'nightly.yml'), 'utf8'))
        .toBe('version: 1.2.3\n')
      expect(await readFile(join(root, 'objects', 'dsh-desk', 'bin', 'win-x64', 'installer.exe'), 'utf8'))
        .toBe('installer bytes')
      await expect(bundleDesktopUpdate(plan, output)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an object path that escapes the deployment root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bundle-test-'))
    try {
      const plan: DesktopUploadPlan = { environment: 'production', target: 'win-x64', version: '1.2.3',
        publicUrl: 'https://updates.example.com/', bucket: 'unused', secretIdEnvName: 'unused',
        secretKeyEnvName: 'unused', artifacts: [{ path: join(root, 'unused'), filename: 'unused',
          key: '../outside', contentType: 'application/octet-stream', channelMetadata: false }] }
      await expect(bundleDesktopUpdate(plan, join(root, 'release.tar.gz'))).rejects.toThrow(/unsafe object key/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a bundle without update metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bundle-test-'))
    try {
      const binary = join(root, 'installer.exe')
      await writeFile(binary, 'installer bytes')
      const plan: DesktopUploadPlan = { environment: 'production', target: 'win-x64', version: '1.2.3',
        publicUrl: 'https://updates.example.com/', bucket: 'unused', secretIdEnvName: 'unused',
        secretKeyEnvName: 'unused', artifacts: [{ path: binary, filename: 'installer.exe',
          key: 'dsh-desk/bin/win-x64/installer.exe', contentType: 'application/octet-stream',
          channelMetadata: false }] }
      await expect(bundleDesktopUpdate(plan, join(root, 'release.tar.gz'))).rejects.toThrow(/channel metadata/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
