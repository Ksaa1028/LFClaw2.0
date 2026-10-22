/** 校验发布归档后切换独立 systemd 服务；健康检查失败恢复原版本。 */
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import * as tar from 'tar'

const ROOT = '/opt/lfclaw-enterprise'
const UNIT = 'lfclaw-enterprise-admin.service'
const USER = 'lfclaw-enterprise-admin'
const PRODUCT = 'lfclaw-enterprise-admin'
const ID = /^\d{8}(0[1-9]|[1-9]\d)$/

/** 校验归档路径、类型、文件清单和内容，输出到调用方持有的空目录。 */
export async function verifyArchive(archive, stage) {
  if (readdirSync(stage).length) throw new Error('归档校验需要空的临时目录')
  const entries = new Set()
  let bytes = 0
  let archiveError
  await tar.t({ file: archive, strict: true, onReadEntry(entry) {
    const path = entry.path.replace(/\/$/, '')
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')
      || !['File', 'Directory'].includes(entry.type) || entries.has(path)
      || !/^(release\.json|deploy\.mjs|run\.mjs|runtime(?:\/.*)?|web(?:\/.*)?)$/.test(path)) {
      archiveError ??= new Error(`归档包含不允许的条目：${entry.path}`)
    }
    entries.add(path)
    bytes += entry.size
    if (entries.size > 100000 || bytes > 2 * 1024 ** 3) archiveError ??= new Error('归档超过 100000 项或 2 GiB 解压上限')
  } })
  if (archiveError) throw archiveError
  await tar.x({ file: archive, cwd: stage, strict: true, noChmod: true, noMtime: true })
  const manifest = JSON.parse(readFileSync(join(stage, 'release.json'), 'utf8'))
  if (manifest.product !== PRODUCT || manifest.format !== 1 || manifest.dataSchema !== 1
    || !ID.test(manifest.releaseId) || !['linux-x64', 'win32-x64'].includes(manifest.target) || !Array.isArray(manifest.files)) {
    throw new Error('发布清单的产品、格式、数据版本或目标无效')
  }
  const declared = new Set()
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !entries.has(file.path) || declared.has(file.path) || file.path === 'release.json'
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{128}$/.test(file.sha512)) throw new Error('发布文件清单无效')
    declared.add(file.path)
    const path = join(stage, file.path)
    if (!lstatSync(path).isFile()) throw new Error(`清单条目不是普通文件：${file.path}`)
    const content = readFileSync(path)
    if (content.length !== file.bytes || createHash('sha512').update(content).digest('hex') !== file.sha512) {
      throw new Error(`文件不完整或已损坏：${file.path}`)
    }
  }
  for (const path of entries) if (path !== 'release.json' && lstatSync(join(stage, path)).isFile() && !declared.has(path)) {
    throw new Error(`归档包含未声明文件：${path}`)
  }
  for (const path of ['run.mjs', 'deploy.mjs', 'runtime/lib/bin.js', 'runtime/cordis.admin.patch.yml', 'web/index.html']) {
    if (!declared.has(path)) throw new Error(`归档缺少必要文件：${path}`)
  }
  return manifest
}

function command(program, args) {
  return execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim()
}
function writeAtomic(path, content, mode = 0o600) {
  const temporary = `${path}.new`
  writeFileSync(temporary, content, { flag: 'wx', mode })
  renameSync(temporary, path)
}
function pointLive(admin, version) {
  const temporary = join(admin, 'live.new')
  symlinkSync(`versions/${version}`, temporary)
  renameSync(temporary, join(admin, 'live'))
}
function activeVersion(admin) {
  const live = join(admin, 'live')
  if (!existsSync(live)) {
    try { lstatSync(live) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    throw new Error('live 指向不存在的版本，请先检查部署状态')
  }
  if (!lstatSync(live).isSymbolicLink()) throw new Error('live 必须是版本符号链接')
  const target = readlinkSync(live)
  if (!/^versions\/\d{10}$/.test(target)) throw new Error('live 指向了版本目录以外的位置')
  return basename(target)
}
/** 同时验证发布版本和企业 API 鉴权响应，避免仅网页启动被报告为部署成功。 */
export async function checkHealth(config, version) {
  const host = isIP(config.bindHost) === 6 ? `[${config.bindHost}]` : config.bindHost
  const origin = `http://${host}:${config.port}`
  const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1500) })
  if (!response.ok) return false
  const value = await response.json()
  if (value.product !== PRODUCT || value.releaseId !== version || value.ready !== true) return false
  const api = await fetch(`${origin}/lfclaw/api/admin/status`, { signal: AbortSignal.timeout(1500) })
  return api.status === 401 && (await api.json()).code === 'UNAUTHORIZED'
}
async function waitHealthy(config, version, signal) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    try {
      if (await checkHealth(config, version)) return
    } catch (error) {
      // 启动窗口允许连接尚未建立；到期后由部署调用方恢复旧版本。
      if (!(error instanceof Error)) throw error
    }
    await new Promise(done => setTimeout(done, 500))
  }
  throw new Error(`版本 ${version} 的健康检查超时：需要网页和企业 API 均可用`)
}
async function assertPortFree(config) {
  await new Promise((done, reject) => {
    const listener = createServer()
    listener.once('error', reject)
    listener.listen(config.port, config.bindHost, () => { listener.close(error => error ? reject(error) : done()) })
  })
}
async function preflight(versionPath, dataDirectory, releaseId) {
  const directory = mkdtempSync(join(dataDirectory, '.preflight-'))
  const uid = Number(command('id', ['-u', USER]))
  const gid = Number(command('id', ['-g', USER]))
  command('chown', [`${USER}:${USER}`, directory])
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise(done => listener.close(done))
  const config = { bindHost: '127.0.0.1', port, publicOrigin: `http://127.0.0.1:${port}`,
    dataDirectory: directory, initialPassword: randomBytes(24).toString('hex') }
  const path = join(directory, 'config.json')
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 })
  command('chown', [`${USER}:${USER}`, path])
  let logs = ''
  const child = spawn('/usr/bin/node', [join(versionPath, 'run.mjs'), path], {
    cwd: versionPath, uid, gid, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: directory, NODE_ENV: 'production' },
  })
  const exited = once(child, 'exit')
  const controller = new AbortController()
  child.stdout.on('data', value => { logs = (logs + value).slice(-4000) })
  child.stderr.on('data', value => { logs = (logs + value).slice(-4000) })
  try {
    await Promise.race([
      waitHealthy(config, releaseId, controller.signal),
      exited.then(() => { throw new Error(`临时启动失败：${logs}`) }),
    ])
    console.log('服务器临时启动检查通过，开始启用正式管理端。')
  } finally {
    controller.abort()
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
      const killTimer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') console.error(error.message) }
      }, 10000)
      await exited.finally(() => clearTimeout(killTimer))
    }
    rmSync(directory, { recursive: true, force: true })
  }
}
function validateConfig(config) {
  if (!isIP(config.bindHost) || ['0.0.0.0', '::'].includes(config.bindHost)
    || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535
    || config.dataDirectory !== `${ROOT}/admin/data`) throw new Error('管理端绑定地址、端口或数据目录无效')
  const origin = new URL(config.publicOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.publicOrigin) throw new Error('publicOrigin 必须是完整 HTTP/HTTPS 来源地址，不含路径')
}
async function deploy(archive, stage, manifest, values) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || manifest.target !== 'linux-x64') throw new Error('部署只支持 Linux x64；其他系统可使用 --verify-only')
  if (process.getuid() !== 0) throw new Error('请使用 root 执行部署')
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('此发布包需要 Node.js 24 或更高版本')
  if (existsSync(ROOT) && (!lstatSync(ROOT).isDirectory() || lstatSync(ROOT).isSymbolicLink())) throw new Error('新服务根目录不能是符号链接')
  const marker = join(ROOT, '.lfclaw-enterprise')
  if (existsSync(ROOT) && !existsSync(marker) && readdirSync(ROOT).some(name => name !== 'packages')) throw new Error('新目录中已有不属于本部署的内容')
  const admin = join(ROOT, 'admin')
  const unitPath = `/etc/systemd/system/${UNIT}`
  const installedUnit = command('systemctl', ['show', UNIT, '-p', 'FragmentPath', '--value'])
  if (installedUnit && (installedUnit !== unitPath || !existsSync(marker))) throw new Error('同名服务已存在且不属于本部署')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() !== PRODUCT) throw new Error('部署目录身份不匹配')
  if (existsSync(unitPath) && !readFileSync(unitPath, 'utf8').startsWith(`# ${PRODUCT}\n`)) throw new Error('同名 systemd 文件不属于本部署')
  mkdirSync(ROOT, { recursive: true })
  const lock = join(ROOT, '.deploy-lock')
  mkdirSync(lock) // 原子互斥；失败时不得继续切换版本。
  try {
    const configPath = join(admin, 'config/runtime.json')
    let config
    if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'))
    else {
      if (!values.host || !values.origin || (process.env.LFCLAW_ADMIN_PASSWORD?.length ?? 0) < 12) {
        throw new Error('首次部署需要 --host、--origin，以及至少 12 字符的 LFCLAW_ADMIN_PASSWORD 环境变量')
      }
      config = { bindHost: values.host, port: Number(values.port ?? '39811'), publicOrigin: values.origin,
        dataDirectory: `${ROOT}/admin/data`, initialPassword: process.env.LFCLAW_ADMIN_PASSWORD }
    }
    validateConfig(config)
    const previous = activeVersion(admin)
    if (previous && manifest.releaseId <= previous) throw new Error('更新编号必须大于当前版本；同一版本不重复部署')
    if (previous) {
      const current = JSON.parse(readFileSync(join(admin, 'versions', previous, 'release.json'), 'utf8'))
      if (current.dataSchema !== manifest.dataSchema) throw new Error('数据格式变化需要单独迁移，自动部署已停止')
    }
    const state = command('systemctl', ['show', UNIT, '-p', 'ActiveState', '--value'])
    if (state === 'active' && !previous) throw new Error('服务已运行但没有已验证的 live 版本，停止部署以便核对')
    if (state !== 'active') await assertPortFree(config)
    for (const path of ['packages', 'admin/versions', 'admin/config', 'admin/data']) mkdirSync(join(ROOT, path), { recursive: true })
    for (const path of [ROOT, admin, join(admin, 'versions'), join(admin, 'config')]) chmodSync(path, 0o755)
    if (!existsSync(marker)) writeFileSync(marker, `${PRODUCT}\n`, { flag: 'wx', mode: 0o600 })
    const account = command('getent', ['passwd']).split('\n').find(line => line.startsWith(`${USER}:`))
    if (account) {
      const fields = account.split(':')
      if (fields[2] === '0' || fields[5] !== config.dataDirectory || fields[6] !== '/usr/sbin/nologin') throw new Error('同名运行账户属于其他用途')
    } else command('useradd', ['--system', '--user-group', '--home-dir', config.dataDirectory, '--shell', '/usr/sbin/nologin', USER])
    command('chown', [`${USER}:${USER}`, config.dataDirectory])
    command('chmod', ['750', config.dataDirectory])
    if (!existsSync(configPath)) {
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o640 })
      command('chown', [`root:${USER}`, configPath])
    }
    const versionPath = join(admin, 'versions', manifest.releaseId)
    if (existsSync(versionPath)) throw new Error('候选版本目录已存在；请先核对上次部署结果')
    cpSync(stage, versionPath, { recursive: true })
    chmodSync(versionPath, 0o755)
    try {
      await preflight(versionPath, config.dataDirectory, manifest.releaseId)
    } catch (error) {
      throw new Error(`临时启动未通过，正式服务未切换。候选目录保留在 ${versionPath}`, { cause: error })
    }
    const previousUnit = existsSync(unitPath) ? readFileSync(unitPath, 'utf8') : undefined
    const unit = `# ${PRODUCT}
[Unit]
Description=Independent LFClaw enterprise administration
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER}
Group=${USER}
WorkingDirectory=${admin}/live
ExecStart=/usr/bin/node ${admin}/live/run.mjs ${configPath}
Environment=NODE_ENV=production
Environment=HOME=${config.dataDirectory}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${config.dataDirectory}
MemoryHigh=1536M
MemoryMax=2G
CPUQuota=150%
TasksMax=256

[Install]
WantedBy=multi-user.target
`
    let switched = false
    try {
      if (installedUnit) command('systemctl', ['stop', UNIT])
      writeAtomic(unitPath, unit, 0o644)
      command('systemctl', ['daemon-reload'])
      pointLive(admin, manifest.releaseId)
      switched = true
      command('systemctl', ['start', UNIT])
      await waitHealthy(config, manifest.releaseId)
      command('systemctl', ['enable', UNIT])
    } catch (error) {
      let recovery
      try {
        if (existsSync(unitPath)) command('systemctl', ['stop', UNIT])
        if (previousUnit !== undefined) writeAtomic(unitPath, previousUnit, 0o644)
        else if (existsSync(unitPath)) {
          command('systemctl', ['disable', UNIT])
          unlinkSync(unitPath)
        }
        command('systemctl', ['daemon-reload'])
        if (previous) {
          pointLive(admin, previous)
          command('systemctl', ['start', UNIT])
          await waitHealthy(config, previous)
          recovery = `已恢复并验证旧版本 ${previous}`
        } else {
          if (switched) unlinkSync(join(admin, 'live'))
          recovery = '首次部署未启用；数据和候选文件保留'
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `部署失败且无法确认恢复状态，请检查 ${UNIT}；数据未清理`)
      }
      throw new Error(`部署失败；${recovery}`, { cause: error })
    }
    try {
    cpSync(join(stage, 'deploy.mjs'), join(admin, 'deploy.mjs'))
    const helper = join(stage, 'runtime/lfclaw.sh')
    if (existsSync(helper)) {
      cpSync(helper, join(ROOT, 'lfclaw.sh'))
      chmodSync(join(ROOT, 'lfclaw.sh'), 0o755)
    }
    // 登录凭据已初始化，配置文件不再保留初始明文密码。
    if (config.initialPassword) {
      delete config.initialPassword
      writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`, 0o640)
      command('chown', [`root:${USER}`, configPath])
    }
    writeAtomic(join(admin, 'deployment.json'), `${JSON.stringify({ releaseId: manifest.releaseId, previous,
      archive: basename(archive), deployedAt: new Date().toISOString() }, null, 2)}\n`)
    for (const entry of readdirSync(join(admin, 'versions'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name) || entry.name === manifest.releaseId || entry.name === previous) continue
      const old = join(admin, 'versions', entry.name)
      const oldManifest = join(old, 'release.json')
      if (!existsSync(oldManifest)) continue
      const identity = JSON.parse(readFileSync(oldManifest, 'utf8'))
      if (identity.product !== PRODUCT || identity.releaseId !== entry.name) continue
      rmSync(old, { recursive: true })
      const oldArchive = join(ROOT, 'packages', `lfclaw-admin-${entry.name}-linux-x64.tar.gz`)
      if (existsSync(oldArchive) && lstatSync(oldArchive).isFile()) unlinkSync(oldArchive)
    }
    } catch (error) {
      throw new Error(`版本 ${manifest.releaseId} 已启动并通过健康检查，但部署记录或旧包清理失败；请勿重复安装`, { cause: error })
    }
    console.log(`部署完成：${config.publicOrigin}/；版本 ${manifest.releaseId}`)
    console.log(`数据目录：${config.dataDirectory}；服务：${UNIT}`)
    console.log('已保留当前和上一版程序；业务数据、配置和桌面安装包未清理。')
  } finally {
    rmSync(lock, { recursive: true })
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'verify-only': { type: 'boolean' }, host: { type: 'string' }, origin: { type: 'string' }, port: { type: 'string' },
  } })
  const candidates = positionals.length ? positionals : readdirSync(join(ROOT, 'packages'))
    .filter(name => /^lfclaw-admin-\d{10}-linux-x64\.tar\.gz$/.test(name)).sort().reverse().slice(0, 1).map(name => join(ROOT, 'packages', name))
  if (candidates.length !== 1) throw new Error('请指定一个归档，或将完整归档上传到 packages 后执行')
  const archive = resolve(candidates[0])
  const stage = mkdtempSync(join(tmpdir(), 'lfclaw-admin-'))
  try {
    const manifest = await verifyArchive(archive, stage)
    if (values['verify-only']) console.log(`归档校验通过：${manifest.releaseId} ${manifest.target}，${manifest.files.length} 个文件`)
    else await deploy(archive, stage, manifest, values)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message)
  process.exitCode = 1
})
