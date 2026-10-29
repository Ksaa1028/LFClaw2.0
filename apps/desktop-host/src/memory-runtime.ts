/** Resolve LFClaw's bundled native memory engine without a global CLI installation. */
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { runtimeArchivePath } from './office-engine.ts'

/**
 * Locate the installed platform executable, including Electron's unpacked payload.
 * @param runtimeDir - Prepared or ASAR-contained DSH runtime directory.
 * @returns Physical native memory executable path; missing packages fail startup.
 */
export function resolveMemoryExecutable(runtimeDir: string): string {
  const runtimeRequire = createRequire(join(runtimeDir, 'package.json'))
  const cliRequire = createRequire(runtimeRequire.resolve('@mnemon-dev/mnemon/package.json'))
  const manifest = cliRequire.resolve(`@mnemon-dev/mnemon-${process.platform}-${process.arch}/package.json`)
  const binary = join(dirname(manifest), 'bin', process.platform === 'win32' ? 'mnemon.exe' : 'mnemon')
  const archive = runtimeArchivePath(runtimeDir)
  return realpathSync(archive === undefined ? binary : join(`${archive}.unpacked`, relative(archive, binary)))
}
