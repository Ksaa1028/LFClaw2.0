/** 从正式 LFClaw 源验证低版本发现、签名及完整下载；绝不执行安装器。 */
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, session } from 'electron'
import updaterModule from 'electron-updater'
import { DesktopUpdateCoordinator } from '../../lib/types/update-coordinator.js'
import { verifyLFClawUpdate } from '../../lib/types/lfclaw-update-signature.js'
import { DesktopUpdateHttpExecutor } from '../../lib/types/update-http-executor.js'

const directory = process.env.DSH_LFCLAW_UPDATE_TEST_ROOT
assert.ok(directory, 'Run through scripts/qualify-lfclaw-update.mjs')
app.setPath('userData', join(directory, 'electron'))
async function main() {
await app.whenReady()
console.log('LFClaw online: Electron ready')
const { NsisUpdater } = updaterModule
const expected = process.argv[2]
const installed = process.argv[3] ?? '2026.10.21-9'
const url = 'http://8.216.38.213:39811/lfclaw-updates/win-x64/'
if (process.argv.includes('--direct')) await session.fromPartition('electron-updater').setProxy({ mode: 'direct' })
console.log(`LFClaw network route: ${await session.fromPartition('electron-updater').resolveProxy(url)}`)
const key = readFileSync(new URL('../../resources/lfclaw-update-public.pem', import.meta.url), 'utf8')
const config = join(directory, 'app-update.yml')
writeFileSync(config, 'updaterCacheDirName: lfclaw-qualification\n')
const forbidden = () => { throw new Error('Qualification must not install or restart') }
const updater = new NsisUpdater(undefined, { version: installed, name: 'lfclaw-qualification', isPackaged: true,
  appUpdateConfigPath: config, userDataPath: directory, baseCachePath: directory,
  whenReady: async () => {}, quit: forbidden, relaunch: forbidden, onQuit: forbidden })
updater.disableDifferentialDownload = true
updater.disableWebInstaller = true
updater.httpExecutor = new DesktopUpdateHttpExecutor(60_000)
updater.setFeedURL({ provider: 'generic', url, channel: 'nightly' })
updater.logger = console
updater.on('download-progress', progress => { console.log(`LFClaw download: ${Math.floor(progress.percent)}%`) })
updater.quitAndInstall = forbidden
const check = updater.checkForUpdates.bind(updater)
updater.checkForUpdates = async () => {
  const result = await check()
  verifyLFClawUpdate(result.updateInfo, key)
  return result
}
const coordinator = new DesktopUpdateCoordinator(state => state, async () => false, updater, () => true, () => installed)
try {
  const available = await coordinator.check(true)
  if (installed === expected) {
    assert.deepEqual(available, { phase: 'idle' })
    console.log('LFClaw online: installed latest version does not offer a duplicate update')
    coordinator.dispose()
    app.exit(0)
    return
  }
  assert.deepEqual(available, { phase: 'available', version: expected })
  console.log(`LFClaw online: older client discovers ${expected}; signature accepted`)
  if (process.argv[4] === '--check-only') { coordinator.dispose(); app.exit(0); return }
  const ready = await coordinator.download(expected)
  assert.equal(ready.phase, 'ready', JSON.stringify(ready))
  console.log('LFClaw online: complete installer downloaded and SHA-512 verified; installation not executed')
  coordinator.dispose()
  app.exit(0)
} catch (error) {
  console.error(error)
  coordinator.dispose()
  app.exit(1)
}
}
const deadline = setTimeout(() => { console.error('LFClaw online verification timed out'); app.exit(1) }, 900_000)
void main().catch(error => { console.error(error); app.exit(1) }).finally(() => { clearTimeout(deadline) })
