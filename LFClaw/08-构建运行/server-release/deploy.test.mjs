/** 发布输入的拒绝行为；所有文件均位于测试专用临时目录。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { once } from 'node:events'
import * as tar from 'tar'
import { verifyArchive, checkHealth } from './deploy.mjs'

test('网页已就绪但企业 API 缺失或异常时拒绝健康通过', async () => {
  let apiStatus = 404
  let code = 'UNAUTHORIZED'
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/healthz') response.end(JSON.stringify({ product: 'lfclaw-enterprise-admin', releaseId: '2026102008', ready: true }))
    else { response.statusCode = apiStatus; response.end(JSON.stringify({ code })) }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const config = { bindHost: '127.0.0.1', port: server.address().port }
    assert.equal(await checkHealth(config, '2026102008'), false)
    apiStatus = 500
    assert.equal(await checkHealth(config, '2026102008'), false)
    apiStatus = 401
    code = 'WRONG_SERVICE'
    assert.equal(await checkHealth(config, '2026102008'), false)
    code = 'UNAUTHORIZED'
    assert.equal(await checkHealth(config, '2026102008'), true)
    assert.equal(await checkHealth(config, '2026102007'), false)
  } finally {
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
  }
})

async function fixture(run, mutation) {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-archive-test-'))
  try {
    const source = join(directory, 'source')
    const output = join(directory, 'output')
    mkdirSync(source)
    mkdirSync(output)
    const paths = ['run.mjs', 'deploy.mjs', 'runtime/lib/bin.js', 'runtime/cordis.admin.patch.yml', 'web/index.html']
    const files = paths.map(path => {
      mkdirSync(dirname(join(source, path)), { recursive: true })
      writeFileSync(join(source, path), 'test')
      return { path, bytes: 4, sha512: createHash('sha512').update('test').digest('hex') }
    })
    const manifest = { product: 'lfclaw-enterprise-admin', format: 1, dataSchema: 1, releaseId: '2026102001', target: 'linux-x64', files }
    mutation?.(source, manifest)
    writeFileSync(join(source, 'release.json'), JSON.stringify(manifest))
    const archive = join(directory, 'release.tar.gz')
    await tar.c({ file: archive, gzip: true, cwd: source }, readdirSync(source))
    await run(archive, output)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
test('完整发布包通过内容校验', async () => {
  await fixture(async (archive, output) => { assert.equal((await verifyArchive(archive, output)).releaseId, '2026102001') })
})
test('内容损坏拒绝激活', async () => {
  await fixture(async (archive, output) => { await assert.rejects(verifyArchive(archive, output), /损坏/) },
    source => writeFileSync(join(source, 'web/index.html'), 'changed'))
})
test('归档中的持久数据目录被拒绝，且尚未解压', async () => {
  await fixture(async (archive, output) => {
    await assert.rejects(verifyArchive(archive, output), /不允许/)
    assert.deepEqual(readdirSync(output), [])
  }, source => { mkdirSync(join(source, 'data')); writeFileSync(join(source, 'data/db.json'), '{}') })
})
test('未声明文件与重复清单条目被拒绝', async () => {
  await fixture(async (archive, output) => { await assert.rejects(verifyArchive(archive, output), /未声明/) },
    source => writeFileSync(join(source, 'web/extra.js'), 'unexpected'))
  await fixture(async (archive, output) => { await assert.rejects(verifyArchive(archive, output), /清单无效/) },
    (_source, manifest) => manifest.files.push(manifest.files[0]))
})
test('其他产品或数据版本不会作为管理端发布', async () => {
  for (const change of [{ product: 'old-lfclaw' }, { dataSchema: 2 }]) {
    await fixture(async (archive, output) => { await assert.rejects(verifyArchive(archive, output), /发布清单/) },
      (_source, manifest) => Object.assign(manifest, change))
  }
})
test('符号链接和目录穿越条目在解压前被拒绝', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-header-test-'))
  try {
    for (const value of [{ path: '../outside', type: 'File', size: 0 },
      { path: 'runtime/link', type: 'SymbolicLink', linkpath: '/etc/passwd', size: 0 }]) {
      const header = new tar.Header(value)
      header.encode()
      const archive = join(directory, 'invalid.tar')
      writeFileSync(archive, Buffer.concat([header.block, Buffer.alloc(1024)]))
      const output = mkdtempSync(join(directory, 'output-'))
      await assert.rejects(verifyArchive(archive, output), /不允许/)
      assert.deepEqual(readdirSync(output), [])
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
