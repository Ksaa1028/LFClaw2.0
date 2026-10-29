/** Launch a packaged Windows client with isolated data and require its LFClaw interface to mount. */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { _electron } from 'playwright'

const executablePath = process.argv[2]
if (!executablePath) throw new Error('Usage: node smoke-desktop-boot.mjs <LFClaw.exe>')
const updateConfig = await readFile(join(dirname(resolve(executablePath)), 'resources/app-update.yml'), 'utf8')
if (!updateConfig.includes('http://8.216.38.213:39811/lfclaw-updates/win-x64/') || /download\.deepseek\.com/.test(updateConfig)) {
  throw new Error('Desktop update feed must point only to LFClaw')
}
const directory = await mkdtemp(join(tmpdir(), 'lfclaw-ui-smoke-'))
const environment = { ...process.env, DSH_HOME: join(directory, 'home'), APPDATA: join(directory, 'appdata'),
  HOME: directory, USERPROFILE: directory }
delete environment.MNEMON_CLI_PATH
delete environment.ELECTRON_RUN_AS_NODE
let application
try {
  application = await _electron.launch({
    executablePath: resolve(executablePath),
    args: [`--user-data-dir=${join(directory, 'electron')}`],
    env: environment,
    timeout: 60_000,
  })
  await application.evaluate(({ app, BrowserWindow, dialog }) => {
    app.setAsDefaultProtocolClient = () => false
    BrowserWindow.prototype.show = function () {}
    BrowserWindow.prototype.showInactive = function () {}
    for (const window of BrowserWindow.getAllWindows()) window.hide()
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  })
  const page = await application.firstWindow({ timeout: 60_000 })
  await page.locator('[data-slot="sidebar.brand.mark"] img[data-lfclaw-logo]').waitFor({ state: 'attached', timeout: 60_000 })
  const wordmark = page.locator('[data-slot="sidebar.brand.name"] [data-lfclaw-brand="name"]')
  await wordmark.waitFor({ state: 'attached', timeout: 60_000 })
  if (await wordmark.textContent() !== 'LFClaw') throw new Error('Desktop product name is not LFClaw')
  await page.getByRole('button', { name: /渠道接入|Channel Connections/i, includeHidden: true }).first().waitFor({ state: 'attached', timeout: 60_000 })
  const memory = page.getByRole('button', { name: /^(记忆系统|Memory System)$/, includeHidden: true }).first()
  await memory.waitFor({ state: 'attached', timeout: 60_000 })
  await memory.dispatchEvent('click')
  await page.getByText(/运行时记忆|Runtime Memory/i).first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.getByRole('button', { name: /^(设置|Settings)$/, includeHidden: true }).first().dispatchEvent('click')
  const versionRow = page.locator('[data-client-version]')
  await versionRow.waitFor({ state: 'attached', timeout: 30_000 })
  const installedVersion = await application.evaluate(({ app }) => app.getVersion())
  const updateMetadata = await application.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    const manifest = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
    return { key: manifest.lfclawUpdatePublicKey, policy: manifest.dshMandatoryUpdatePolicy }
  })
  if (typeof updateMetadata.key !== 'string' || !updateMetadata.key.includes('BEGIN PUBLIC KEY') || updateMetadata.policy !== undefined) {
    throw new Error('LFClaw update key missing or original mandatory update policy still enabled')
  }
  if (await versionRow.getAttribute('data-client-version') !== installedVersion) throw new Error('Settings version differs from installed Desktop version')
  if (await page.locator('body').innerText().then(text => text.includes('did not activate'))) {
    throw new Error('Desktop client plugin activation failed')
  }
  await page.waitForTimeout(15_000)
  if (!(await page.locator('#root').innerText()).includes('LFClaw')) {
    throw new Error('Desktop interface disappeared after initial startup')
  }
  if (process.argv[3]) await page.screenshot({ path: resolve(process.argv[3]) })
  console.log(`desktop UI: LFClaw brand name, logo, IM assistant, default memory and installed version ${installedVersion} verified`)
} finally {
  if (application !== undefined) await application.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
