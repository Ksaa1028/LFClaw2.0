/** 从归档启动真实 dsh profile，验证登录、静态页面和重启后数据/令牌保留。 */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { verifyArchive, checkHealth } from './deploy.mjs'

const temp = mkdtempSync(join(tmpdir(), 'lfclaw-smoke-'))
const release = join(temp, 'release')
mkdirSync(release)
const manifest = await verifyArchive(resolve(process.argv[2]), release)
if (manifest.target !== `${process.platform}-${process.arch}`) throw new Error('冒烟验证需要当前操作系统对应的归档')
const probe = createServer()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise(done => probe.close(done))
const origin = `http://127.0.0.1:${port}`
const data = join(temp, 'data')
const configPath = join(temp, 'config.json')
const desktopDirectory = join(temp, 'desktop')
mkdirSync(join(desktopDirectory, 'win-x64'), { recursive: true })
writeFileSync(join(desktopDirectory, 'win-x64/nightly.yml'), '{"version":"2026.10.21-9"}')
writeFileSync(join(desktopDirectory, 'win-x64/LFClaw-2026102109-windows-x64.exe'), '0123456789')
const config = { bindHost: '127.0.0.1', port, publicOrigin: 'http://8.216.38.213:39811',
  dataDirectory: data, desktopDirectory, initialPassword: 'smoke-admin-password-123' }
writeFileSync(configPath, JSON.stringify(config))
let child
let logs = ''
async function start() {
  child = spawn(process.execPath, [join(release, 'run.mjs'), configPath], {
    cwd: temp, env: { ...process.env, NODE_PATH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  child.on('error', error => { logs += error.stack })
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`启动失败：${logs}`)
    try {
      if (await checkHealth(config, manifest.releaseId)) return
    } catch (error) { if (!(error instanceof Error)) throw error }
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error(`健康检查超时：${logs}`)
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exit = once(child, 'exit')
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
  await exit
}
async function request(path, method = 'GET', token, body) {
  return fetch(`${origin}/lfclaw/api${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) })
}
try {
  await start()
  assert.equal((await fetch(origin)).status, 200)
  const feed = await fetch(`${origin}/lfclaw-updates/win-x64/nightly.yml`)
  assert.equal(feed.headers.get('cache-control'), 'no-store')
  assert.equal((await feed.json()).version, '2026.10.21-9')
  const range = await fetch(`${origin}/lfclaw-updates/win-x64/LFClaw-2026102109-windows-x64.exe`, { headers: { Range: 'bytes=2-4' } })
  assert.equal(range.status, 206)
  assert.equal(await range.text(), '234')
  assert.equal((await fetch(`${origin}/lfclaw-updates/win-x64/.env`)).status, 403)
  assert.equal((await fetch(`${origin}/runtime/package.json`)).status, 404)
  assert.equal((await fetch(`${origin}/data/db.json`)).status, 404)
  assert.equal((await fetch(`${origin}/rpc`)).status, 404)
  assert.equal((await request('/admin/status')).status, 401)
  const login = await request('/admin/login', 'POST', undefined, { username: 'admin', password: 'smoke-admin-password-123' })
  assert.equal(login.status, 200)
  const { token } = await login.json()
  assert.equal((await request('/admin/data/departments', 'POST', token, { id: 'retained', name: '保留测试部门' })).status, 201)
  await stop()
  const { initialPassword: _initialPassword, ...persistedConfig } = config
  writeFileSync(configPath, JSON.stringify(persistedConfig))
  await start()
  assert.equal((await request('/admin/status', 'GET', token)).status, 200)
  const db = JSON.parse(readFileSync(join(data, 'db.json'), 'utf8'))
  assert.equal(db.departments.find(item => item.id === 'retained').name, '保留测试部门')
  console.log('通过：归档外部启动、健康检查、管理网页、API 鉴权、私有文件隔离、重启后部门和登录令牌保留。')
} finally {
  await stop()
  rmSync(temp, { recursive: true, force: true })
}
