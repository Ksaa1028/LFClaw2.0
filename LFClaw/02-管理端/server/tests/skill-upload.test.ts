import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { createApp } from '../src/app.ts'
import { AuthService } from '../src/auth.ts'
import { JsonStore } from '../src/store.ts'
import type { Limits } from '../src/skill-archive.ts'
import { skillArchiveLimits } from './skill-limits.ts'

async function fixture(t: TestContext, limits: Limits) {
  const directory = await mkdtemp(join(tmpdir(), 'lfclaw-skill-upload-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const auth = new AuthService(join(directory, 'auth.json'), 'fixture-password', { adminMs: 60000, employeeMs: 60000 })
  const token = auth.login('admin', 'fixture-password')
  assert(token)
  const skillsDirectory = join(directory, 'skills')
  const server = createApp({ skillArchiveLimits: limits, store: new JsonStore(join(directory, 'db.json')), auth,
    dataDirectory: directory, skillsDirectory, allowedOrigin: 'http://localhost', modelTimeoutMs: 30000,
    authWindowMs: 60000, loginMaxFailures: 3, activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  return { skillsDirectory, async upload(bytes: Uint8Array) {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)]), 'skill.zip')
    return fetch(`http://127.0.0.1:${address.port}/api/admin/skills/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    })
  } }
}

test('上传超过旧 20 MiB 请求上限且包含 200 多个文件的技能，原样保存', async (t) => {
  const { skillsDirectory, upload } = await fixture(t, skillArchiveLimits)
  // 不压缩的模板数据同时覆盖请求体与 ZIP 校验的原有体积上限。
  const archive = zipSync({
    'SKILL.md': strToU8('---\nname: presentation-helper\ndescription: 制作演示文稿\n---\n# 制作步骤\n'),
    'templates/payload.bin': new Uint8Array(21 * 1024 * 1024),
    ...Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`templates/${index}.svg`, strToU8('模板')])),
  }, { level: 0 })
  const response = await upload(archive)
  assert.equal(response.status, 201)
  const value = await response.json() as { path: string; description: string }
  assert.equal(value.description, '制作演示文稿')
  assert.deepEqual(new Uint8Array(await readFile(join(skillsDirectory, value.path))), archive)
})

test('上传请求和内容校验都遵守更小的部署上限，拒绝后不保存文件', async (t) => {
  const { skillsDirectory, upload } = await fixture(t, { maxArchiveBytes: 1024, maxUnpackedBytes: 1024, maxFiles: 1 })
  const source = strToU8('---\nname: small-skill\ndescription: 测试\n---\n步骤\n')
  const tooMany = await upload(zipSync({ 'SKILL.md': source, 'extra.md': strToU8('资料') }))
  assert.equal(tooMany.status, 400)
  assert.equal((await tooMany.json() as { code: string }).code, 'INVALID_SKILL')
  const tooLarge = await upload(zipSync({ 'SKILL.md': source, 'large.bin': new Uint8Array(2048) }, { level: 0 }))
  assert.equal(tooLarge.status, 400)
  assert.equal((await tooLarge.json() as { code: string }).code, 'UPLOAD_INVALID')
  assert.deepEqual(await readdir(skillsDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  }), [])
})
