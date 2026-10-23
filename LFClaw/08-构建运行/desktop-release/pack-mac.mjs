/** Sign and archive a verified Apple Silicon DMG for the LFClaw manual-update feed. */
import { createHash, sign } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import * as tar from 'tar'
import { desktopVersionForReleaseId } from '../../../apps/desktop/scripts/lfclaw-release-id.mjs'

const root = resolve(import.meta.dirname, '../../..')
const id = process.argv[2]
const input = process.argv[3]
if (input === undefined) throw new Error('Usage: node pack-mac.mjs <release-id> <verified-dmg-path>')
const version = desktopVersionForReleaseId(id, '0.2.1-alpha.2')
const output = join(root, 'apps/desktop/.desktop-build/release-bundles')
const filename = `LFClaw-${id}-mac-arm64.dmg`
const stage = join(output, `update-mac-${id}`)
const archive = join(output, `lfclaw-mac-arm64-${id}.tar.gz`)
if (existsSync(stage) || existsSync(archive)) throw new Error('发布编号已存在，禁止覆盖')
const bytes = readFileSync(resolve(input))
const payload = { version, files: [{ url: filename, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }] }
const key = readFileSync(join(homedir(), '.codex/lfclaw-release/update-private.pem'))
const feed = { ...payload, lfclawSignature: sign(null, Buffer.from(JSON.stringify(payload)), key).toString('base64') }
mkdirSync(stage, { recursive: true })
copyFileSync(resolve(input), join(stage, filename))
writeFileSync(join(stage, 'nightly.yml'), `${JSON.stringify(feed, null, 2)}\n`)
copyFileSync(join(root, 'apps/desktop/resources/lfclaw-update-public.pem'), join(stage, 'update-public.pem'))
const files = [filename, 'nightly.yml', 'update-public.pem'].map(path => {
  const content = readFileSync(join(stage, path))
  return { path, size: content.length, sha512: createHash('sha512').update(content).digest('hex') }
})
writeFileSync(join(stage, 'release.json'), `${JSON.stringify({ product: 'LFClaw', target: 'mac-arm64', releaseId: id, version, files }, null, 2)}\n`)
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild')
await build({ entryPoints: [join(import.meta.dirname, 'deploy.mjs')], outfile: join(stage, 'deploy.mjs'), bundle: true,
  platform: 'node', format: 'esm', target: 'node24', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } })
await tar.c({ file: archive, gzip: true, cwd: stage, portable: true }, ['release.json', 'deploy.mjs', ...files.map(file => file.path)])
console.log(JSON.stringify({ archive, version, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') }))
