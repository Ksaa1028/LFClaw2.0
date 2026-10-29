import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveMemoryExecutable } from '../src/memory-runtime.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it.each([false, true])('resolves the bundled memory executable with ASAR=%s without PATH', (archived) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lfclaw-memory-')))
  roots.push(root)
  const runtime = join(root, ...(archived ? ['app.asar', 'dsh'] : ['dsh']))
  const native = `node_modules/@mnemon-dev/mnemon-${process.platform}-${process.arch}`
  for (const name of ['node_modules/@mnemon-dev/mnemon', native]) {
    const path = join(runtime, name, 'package.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{}')
  }
  const binary = join(archived ? join(root, 'app.asar.unpacked', 'dsh') : runtime,
    native, 'bin', process.platform === 'win32' ? 'mnemon.exe' : 'mnemon')
  expect(() => resolveMemoryExecutable(runtime)).toThrow()
  mkdirSync(dirname(binary), { recursive: true })
  writeFileSync(binary, 'fixture')
  expect(resolveMemoryExecutable(runtime)).toBe(realpathSync(binary))
})
