/** Own an isolated Electron update check and clean its data only after Electron exits. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = await mkdtemp(join(tmpdir(), 'lfclaw-update-check-'))
const env = { ...process.env, DSH_LFCLAW_UPDATE_TEST_ROOT: root }
delete env.ELECTRON_RUN_AS_NODE
try {
  const child = spawn(electron, [fileURLToPath(new URL('../tests/fixtures/lfclaw-online-update.mjs', import.meta.url)), ...process.argv.slice(2)], {
    env, stdio: 'inherit', windowsHide: true,
  })
  const timer = setTimeout(() => { child.kill() }, 960_000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    if (code !== 0) throw new Error(`LFClaw update qualification failed: ${code}`)
  } finally { clearTimeout(timer) }
} finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) }
