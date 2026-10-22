/** 配置读取包装器：应用仍由发布包内的 dsh --profile lfclaw-admin 启动。 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const release = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const manifest = JSON.parse(readFileSync(join(release, 'release.json'), 'utf8'))
const origin = new URL(config.publicOrigin)
// 公网 HTTP 管理端不自动配置 OAuth 回调；显式回调仍由企业 API 校验。
const oauthCallbackUrl = config.oauthCallbackUrl ?? (origin.protocol === 'https:'
  || ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
  ? `${origin.origin}/lfclaw/api/connectors/oauth/callback` : '')
const home = join(config.dataDirectory, 'dsh-home')
const profile = join(home, 'profiles', 'lfclaw-admin')
mkdirSync(profile, { recursive: true })
if (!existsSync(join(profile, 'package.json'))) {
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: [] } } }), { flag: 'wx', mode: 0o600 })
}
const child = spawn(process.execPath, [join(release, 'runtime/lib/bin.js'), '--profile', 'lfclaw-admin',
  '--patch', join(release, 'runtime/cordis.admin.patch.yml')], {
  cwd: release, stdio: 'inherit',
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
    LFCLAW_BIND_HOST: config.bindHost, LFCLAW_PORT: String(config.port),
    LFCLAW_PUBLIC_ORIGIN: config.publicOrigin, LFCLAW_DATA_DIR: config.dataDirectory,
    LFCLAW_DESKTOP_DIR: config.desktopDirectory ?? join(dirname(dirname(config.dataDirectory)), 'desktop'),
    LFCLAW_OAUTH_CALLBACK_URL: oauthCallbackUrl,
    LFCLAW_ADMIN_PASSWORD: config.initialPassword ?? '', LFCLAW_WEB_DIR: join(release, 'web'),
    LFCLAW_RELEASE_ID: manifest.releaseId },
})
child.on('error', error => { console.error('管理端启动失败：', error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal) })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
