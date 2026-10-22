import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { EnterpriseSkills, enterpriseInvocation } from '../src/enterprise.ts'

const roots: string[] = []
const limits = { maxArchiveBytes: 10240, maxUnpackedBytes: 20480, maxFiles: 20 }
const archive = (content: string) => zipSync({ 'package/SKILL.md': strToU8(`---\nname: report-helper\ndescription: 企业日报\n---\n${content}\n`), 'package/references/example.md': strToU8('资源') })
const resource = (zip: Uint8Array, version = '1') => ({ id: 'enterprise-resource', name: '日报助手', description: '企业日报', version, sha256: createHash('sha256').update(zip).digest('hex') })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lfclaw-enterprise-skills-')); roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('并发请求共享下载，重启后复用已验证版本；版本更新和回滚均读取正确正文', async () => {
  const root = await fixture()
  const v1 = archive('版本一的指令'), v2 = archive('版本二的指令')
  const request = vi.fn().mockImplementation(async () => new Response(v1))
  const service = new EnterpriseSkills(root, limits, request)
  const first = await Promise.all([service.load('a', resource(v1)), service.load('a', resource(v1))])
  expect(first[0].content).toContain('版本一')
  expect(request).toHaveBeenCalledOnce()
  const restarted = new EnterpriseSkills(root, limits, request)
  expect((await restarted.load('a', resource(v1))).content).toContain('版本一')
  expect(request).toHaveBeenCalledOnce()
  request.mockImplementation(async () => new Response(v2))
  expect((await restarted.load('a', resource(v2, '2'))).content).toContain('版本二')
  expect((await restarted.load('a', resource(v1))).content).toContain('版本一')
  expect(request).toHaveBeenCalledTimes(2)
  expect(enterpriseInvocation('id-1', 'report-helper')).not.toBe(enterpriseInvocation('id-2', 'report-helper'))
})
it('拒绝内容摘要不一致、权限拒绝和超限包，失败后可以重试', async () => {
  const root = await fixture(), zip = archive('完整指令')
  const request = vi.fn().mockImplementation(async () => new Response('corrupt'))
  const service = new EnterpriseSkills(root, limits, request)
  await expect(service.load('a', resource(zip))).rejects.toThrow('校验失败')
  request.mockImplementation(async () => new Response(null, { status: 403 }))
  await expect(service.load('a', resource(zip))).rejects.toThrow('授权')
  request.mockImplementation(async () => new Response(zip))
  expect((await service.load('a', resource(zip))).content).toContain('完整指令')
  await expect(new EnterpriseSkills(root, { ...limits, maxArchiveBytes: 1 }, request).load('b', resource(zip))).rejects.toThrow('超出限制')
})
