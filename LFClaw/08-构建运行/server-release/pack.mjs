/** 从当前源码构建独立 dsh profile 的最小发布依赖，禁止携带工作区数据。 */
import { createRequire } from 'node:module'
import { builtinModules } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { build as buildWeb } from 'vite'
import * as tar from 'tar'
import yaml from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(join(root, 'package.json'))
// 使用工作区已锁定的 tsx 构建依赖；发布包不携带 tsx 或 esbuild。
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
const { values } = parseArgs({ options: { version: { type: 'string' }, target: { type: 'string', default: 'linux-x64' } } })
const releaseId = values.version
if (!/^\d{8}(0[1-9]|[1-9]\d)$/.test(releaseId ?? '')) throw new Error('使用 --version yyyyMMddxx，序号从 01 开始')
const date = `${releaseId.slice(0, 4)}-${releaseId.slice(4, 6)}-${releaseId.slice(6, 8)}`
if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('发布日期无效')
if (!['linux-x64', 'win32-x64'].includes(values.target)) throw new Error('target 仅支持 linux-x64 和 win32-x64 本地验证')
const target = values.target
const stage = join(root, '.artifacts', 'lfclaw-admin', `${releaseId}-${target}`)
if (existsSync(stage)) throw new Error(`构建目录已存在，请使用新编号或先人工核对：${stage}`)
mkdirSync(stage, { recursive: true })
const runtime = join(stage, 'runtime')
mkdirSync(runtime)
const workspaces = new Map()
function scan(parent, depth) {
  for (const item of readdirSync(parent, { withFileTypes: true })) {
    if (!item.isDirectory()) continue
    const directory = join(parent, item.name)
    if (depth > 0) scan(directory, depth - 1)
    else if (existsSync(join(directory, 'package.json'))) {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      workspaces.set(manifest.name, { directory, manifest })
    }
  }
}
scan(join(root, 'packages'), 1)
scan(join(root, 'vendor'), 0)
for (const directory of ['apps/cli', 'LFClaw/02-管理端/server']) {
  const source = join(root, directory)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  workspaces.set(manifest.name, { directory: source, manifest })
}
const built = new Set()
const manifests = new Map()
const queue = []
const nativeLock = yaml.load(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)])
const bare = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
const metadata = name => {
  if (!manifests.has(name)) {
    const original = workspaces.get(name).manifest
    manifests.set(name, { name, version: original.version, type: 'module', license: original.license ?? 'MIT', exports: {}, dependencies: {} })
  }
  return manifests.get(name)
}
const destination = name => name === '@deepseek-ai/dsh' ? runtime : join(runtime, 'node_modules', name)
function enqueue(specifier) {
  if (built.has(specifier)) return
  built.add(specifier)
  queue.push(specifier)
}
function packageDir(name, from) {
  const resolver = createRequire(join(from, 'package.json'))
  for (const search of resolver.resolve.paths(name) ?? []) {
    const directory = join(search, name)
    if (existsSync(join(directory, 'package.json'))) return realpathSync(directory)
  }
  throw new Error(`缺少构建依赖 ${name}（${from}）`)
}
async function nativePackage(name, version) {
  const cached = join(root, '.artifacts', 'lfclaw-native-cache', `${name}-${version}`)
  if (existsSync(join(cached, 'package.json'))) return cached
  const integrity = nativeLock.packages[`${name}@${version}`]?.resolution?.integrity
  if (!integrity?.startsWith('sha512-')) throw new Error(`原生依赖缺少锁定摘要：${name}@${version}`)
  const response = await fetch(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`原生依赖下载失败：${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error('原生依赖摘要不匹配')
  mkdirSync(cached, { recursive: true })
  const archive = `${cached}.tgz`
  writeFileSync(archive, bytes)
  await tar.x({ file: archive, cwd: cached, strip: 1, strict: true })
  return cached
}
async function copyNpm(name, from, to, ancestors = new Map(), forcedSource) {
  const source = forcedSource ?? packageDir(name, from)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (ancestors.get(name) === manifest.version) return
  const shared = join(runtime, 'node_modules', name)
  const sharedVersion = existsSync(join(shared, 'package.json'))
    ? JSON.parse(readFileSync(join(shared, 'package.json'), 'utf8')).version : undefined
  const output = !ancestors.has(name) && (sharedVersion === undefined || sharedVersion === manifest.version)
    ? shared : join(to, 'node_modules', name)
  if (existsSync(join(output, 'package.json'))) {
    if (JSON.parse(readFileSync(join(output, 'package.json'), 'utf8')).version !== manifest.version) throw new Error(`依赖版本冲突：${name}`)
    return
  }
  mkdirSync(output, { recursive: true })
  cpSync(source, output, { recursive: true, dereference: true, filter: path => {
    const rel = relative(source, path).replaceAll('\\', '/')
    return !rel.split('/').some(part => ['node_modules', '.git', 'test', 'tests', '__tests__', 'docs', 'examples'].includes(part))
      && !/\.(?:map|d\.ts)$/.test(rel)
  } })
  const chain = new Map(ancestors).set(name, manifest.version)
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const fetched = forcedSource && dependency === 'node-addon-native-custom-loader'
      ? await nativePackage(dependency, manifest.dependencies[dependency]) : undefined
    await copyNpm(dependency, source, output, chain, fetched)
  }
  // 此原生模块是 dsh profile 的加载依赖，按目标平台收集，不能复制 Windows 二进制到 Linux。
  if (name === 'node-addon-require-builtin') {
    const nativeName = target === 'linux-x64' ? 'node-addon-require-builtin-linux-x64-gnu' : 'node-addon-require-builtin-win32-x64-msvc'
    const nativeSource = target === 'linux-x64' ? await nativePackage(nativeName, manifest.version) : packageDir(nativeName, source)
    await copyNpm(nativeName, source, output, chain, nativeSource)
  }
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[peer]?.optional) continue
    await copyNpm(peer, source, output, chain)
  }
}
async function compile(specifier) {
  const name = bare(specifier)
  const subpath = specifier.slice(name.length)
  const source = workspaces.get(name)
  const out = destination(name)
  const info = metadata(name)
  let entry
  let output
  if (name === '@deepseek-ai/dsh') {
    entry = subpath === '/profile-boot' ? 'profile-boot' : 'bin'
    output = `lib/${entry}.js`
  } else if (name === '@deepseek-ai/dsh-app-boot' && subpath === '/worker/profile-resolution-bootstrap') {
    entry = 'profile-resolution/worker-bootstrap'
    output = 'lib/worker/profile-resolution-bootstrap.js'
  } else {
    entry = subpath ? subpath.slice(1) : 'index'
    output = `lib/${entry}.js`
  }
  const input = join(source.directory, 'src', `${entry}.ts`)
  if (!existsSync(input)) throw new Error(`未声明的运行入口：${specifier} => ${input}`)
  const result = await build({ entryPoints: [input], outfile: join(out, output), bundle: true, packages: 'external',
    platform: 'node', format: 'esm', target: 'node24', metafile: true, sourcemap: false, logLevel: 'silent',
    plugins: [{ name: 'runtime-package-imports', setup(builder) {
      builder.onResolve({ filter: /^[^./\\]/ }, args => args.kind === 'entry-point' ? undefined : { path: args.path, external: true })
    } }] })
  info.exports[subpath ? `.${subpath}` : '.'] = `./${output}`
  info.exports['./package.json'] = './package.json'
  if (!subpath) info.main = output
  for (const artifact of Object.values(result.metafile.outputs)) for (const dependency of artifact.imports) {
    if (!dependency.external || builtins.has(dependency.path) || dependency.path.startsWith('.')) continue
    const depName = bare(dependency.path)
    if (workspaces.has(depName)) {
      info.dependencies[depName] = workspaces.get(depName).manifest.version
      enqueue(dependency.path)
    } else {
      await copyNpm(depName, source.directory, out)
      info.dependencies[depName] = JSON.parse(readFileSync(join(packageDir(depName, out), 'package.json'), 'utf8')).version
    }
  }
}
for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh/profile-boot', '@deepseek-ai/dsh-app-boot/worker/profile-resolution-bootstrap',
  '@deepseek-ai/cordis-plugin-group', '@deepseek-ai/cordis-plugin-include', '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/dsh-host-webserver', '@deepseek-ai/lfclaw-admin-server', '@deepseek-ai/lfclaw-admin-server/admin-static']) enqueue(name)
for (let index = 0; index < queue.length; index++) {
  console.log(`打包运行模块 ${queue[index]}`)
  await compile(queue[index])
}
// createRequire 的运行时加载不会出现在 esbuild 静态 imports 清单中。
const bootSource = workspaces.get('@deepseek-ai/dsh-app-boot').directory
await copyNpm('node-addon-require-builtin', bootSource, destination('@deepseek-ai/dsh-app-boot'))
metadata('@deepseek-ai/dsh-app-boot').dependencies['node-addon-require-builtin'] =
  JSON.parse(readFileSync(join(packageDir('node-addon-require-builtin', bootSource), 'package.json'), 'utf8')).version
// 动态 Loader 注册和 profile 插件也属于安装包的运行依赖。
const installation = metadata('@deepseek-ai/dsh')
for (const [name, info] of manifests) {
  if (name !== installation.name) installation.dependencies[name] = info.version
  if (name === '@deepseek-ai/dsh') info.bin = { dsh: 'lib/bin.js' }
  writeFileSync(join(destination(name), 'package.json'), `${JSON.stringify(info, null, 2)}\n`)
}
writeFileSync(join(runtime, 'package.json'), `${JSON.stringify(installation, null, 2)}\n`)
cpSync(join(root, 'LFClaw/02-管理端/server/cordis.admin.patch.yml'), join(runtime, 'cordis.admin.patch.yml'))
// Vite 单独输出到本次候选包，避免旧 dist 中已删除的文件混入发布包。
await buildWeb({ root: join(root, 'LFClaw/02-管理端/admin-web'), logLevel: 'warn',
  configFile: join(root, 'LFClaw/02-管理端/admin-web/vite.config.ts'),
  define: { 'import.meta.env.VITE_LFCLAW_API_URL': JSON.stringify('/lfclaw/api') },
  build: { outDir: join(stage, 'web'), emptyOutDir: true, sourcemap: false } })
cpSync(join(import.meta.dirname, 'run.mjs'), join(stage, 'run.mjs'))
cpSync(join(import.meta.dirname, 'lfclaw.sh'), join(runtime, 'lfclaw.sh'))
await build({ entryPoints: [join(import.meta.dirname, 'deploy.mjs')], outfile: join(stage, 'deploy.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } })
const files = []
function inventory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) inventory(path)
    else if (entry.isFile()) {
      const bytes = readFileSync(path)
      files.push({ path: relative(stage, path).replaceAll('\\', '/'), bytes: bytes.length, sha512: createHash('sha512').update(bytes).digest('hex') })
    } else throw new Error(`不允许链接文件：${path}`)
  }
}
inventory(stage)
writeFileSync(join(stage, 'release.json'), `${JSON.stringify({ product: 'lfclaw-enterprise-admin', format: 1, dataSchema: 1, releaseId, target, files }, null, 2)}\n`)
const archive = join(dirname(stage), `lfclaw-admin-${releaseId}-${target}.tar.gz`)
await tar.c({ file: archive, gzip: true, cwd: stage, portable: true }, ['release.json', 'deploy.mjs', 'run.mjs', 'runtime', 'web'])
console.log(`发布包：${archive}`)
console.log(`SHA256：${createHash('sha256').update(readFileSync(archive)).digest('hex')}`)
