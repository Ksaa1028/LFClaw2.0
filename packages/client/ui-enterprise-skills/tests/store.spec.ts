import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { PersonalSkills } from '../src/store.ts'

const roots: string[] = []
const limits = { maxArchiveBytes: 10240, maxUnpackedBytes: 20480, maxFiles: 10 }
const skill =
  '---\nname: report-helper\ndescription: 汇总日报并检查遗漏\n---\n# 工作步骤\n读取用户提供的数据，列出摘要和缺失项。\n'
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lfclaw-skills-'))
  roots.push(root)
  return { root, store: new PersonalSkills(root, limits) }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
describe('个人技能本机存储', () => {
  it('卸载只移除当前员工的技能，重启后仍移除，且可以重新导入', async () => {
    const { root, store } = await fixture()
    const zip = zipSync({ 'SKILL.md': strToU8(skill) })
    await store.import('a', zip)
    await store.import('b', zip)
    await store.remove('a', 'report-helper')
    await store.remove('a', 'report-helper')
    expect(await new PersonalSkills(root, limits).list('a')).toEqual([])
    expect(await store.list('b')).toHaveLength(1)
    await expect(store.remove('a', '../escape')).rejects.toMatchObject({ code: 'metadata' })
    await store.import('a', zip)
    expect(await store.list('a')).toHaveLength(1)
  })
  it('保留 ZIP 资源，重启后可读，其他员工无法看到', async () => {
    const { root, store } = await fixture()
    const nested = skill.replace('name: report-helper', 'name: nested-helper')
    expect(
      await store.import(
        'employee-a',
        zipSync({
          'wrapper/SKILL.md': strToU8(skill),
          'wrapper/references/example.md': strToU8('example'),
          'wrapper/skills/nested/SKILL.md': strToU8(nested),
        }),
      ),
    ).toMatchObject({ name: 'report-helper', description: '汇总日报并检查遗漏', invocationName: 'my-report-helper' })
    const restarted = new PersonalSkills(root, limits)
    expect(await restarted.list('employee-a')).toHaveLength(1)
    expect(await restarted.list('employee-b')).toEqual([])
    expect((await restarted.read('employee-a', 'report-helper')).content).toContain('工作步骤')
    expect(await readdir((await restarted.read('employee-a', 'report-helper')).directory)).toContain('references')
    expect(
      await readFile(join((await restarted.read('employee-a', 'report-helper')).directory, 'skills/nested/SKILL.md'), 'utf8'),
    ).toBe(nested)
  })
  it('兼容已有 ZIP 的数字版本元数据', async () => {
    const { store } = await fixture()
    const saved = await store.import(
      'a',
      zipSync({ 'SKILL.md': strToU8(skill.replace('description:', 'version: 2.3\ndescription:')) }),
    )
    expect(saved.version).toBe('2.3')
  })
  it('对话创建沿用同一校验流程，保留中文简介和调用策略', async () => {
    const { store } = await fixture()
    await store.create('a', { name: 'draft-helper', description: '写作助手', instructions: '# 写作\n先确认目标读者' })
    expect((await store.read('a', 'draft-helper')).invocation).toEqual({ modelInvocable: true, userInvocable: true })
    await expect(store.create('a', { name: '../invalid', description: '描述', instructions: '正文' })).rejects.toMatchObject({
      code: 'metadata',
    })
  })
  it('并发同名导入只有一份成功，不会覆盖原技能', async () => {
    const { store } = await fixture()
    const zip = zipSync({ 'SKILL.md': strToU8(skill) })
    const result = await Promise.allSettled([store.import('a', zip), store.import('a', zip)])
    expect(result.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
    expect(await store.list('a')).toHaveLength(1)
  })
  it.each(['../escape.txt', '/absolute.txt', 'folder\\escape.txt', 'a:stream', 'CON.txt', 'folder/trailing.'])(
    '拒绝不安全的 ZIP 路径 %s',
    async (path) => {
      const { store } = await fixture()
      await expect(store.import('a', zipSync({ 'SKILL.md': strToU8(skill), [path]: strToU8('bad') }))).rejects.toMatchObject({
        code: 'archive',
      })
      expect(await store.list('a')).toEqual([])
    },
  )
  it('拒绝多个技能定义和缺少元数据的包', async () => {
    const { store } = await fixture()
    await expect(
      store.import('a', zipSync({ 'a/SKILL.md': strToU8(skill), 'b/SKILL.md': strToU8(skill) })),
    ).rejects.toMatchObject({ code: 'metadata' })
    await expect(store.import('a', zipSync({ 'SKILL.md': strToU8('# 无元数据') }))).rejects.toMatchObject({ code: 'metadata' })
  })
  it('拒绝超量文件、解压超限、压缩超限和损坏的 ZIP', async () => {
    const { root, store } = await fixture()
    await expect(
      new PersonalSkills(root, { ...limits, maxFiles: 1 }).import(
        'a',
        zipSync({ 'SKILL.md': strToU8(skill), 'extra.md': strToU8('x') }),
      ),
    ).rejects.toMatchObject({ code: 'archive' })
    await expect(
      new PersonalSkills(root, { ...limits, maxUnpackedBytes: 10 }).import('a', zipSync({ 'SKILL.md': strToU8(skill) })),
    ).rejects.toMatchObject({ code: 'archive' })
    await expect(
      new PersonalSkills(root, { ...limits, maxArchiveBytes: 1 }).import('a', zipSync({ 'SKILL.md': strToU8(skill) })),
    ).rejects.toMatchObject({ code: 'archive' })
    await expect(store.import('a', strToU8('not a zip'))).rejects.toMatchObject({ code: 'archive' })
  })

  it('编辑保留附件和调用标志；并发旧摘要不能覆盖，停用与版本重启后保留', async () => {
    const { store, root } = await fixture()
    await store.import(
      'a',
      zipSync({
        'SKILL.md': strToU8(skill.replace('description:', 'disable-model-invocation: true\nuser-invocable: false\ndescription:')),
        'references/guide.md': strToU8('保留资料'),
      }),
    )
    const prior = await store.read('a', 'report-helper')
    const input = { description: '新简介', instructions: '新的步骤', enabled: false, version: '2.0.0' }
    const updated = await store.update('a', prior.name, input, prior.revision)
    expect(updated).toMatchObject({ description: '新简介', enabled: false, version: '2.0.0', userInvocable: false })
    const item = await new PersonalSkills(root, limits).read('a', prior.name)
    expect(item.content).toContain('新的步骤')
    expect(item.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    expect(await readdir(item.directory)).toContain('references')
    await expect(store.update('a', prior.name, input, prior.revision)).rejects.toMatchObject({ code: 'conflict' })
  })
  it('替换同名 ZIP 需要当前摘要且替换资源；失效确认不会覆盖更新', async () => {
    const { store } = await fixture()
    const first = await store.import('a', zipSync({ 'SKILL.md': strToU8(skill), 'old.md': strToU8('旧') }))
    const zip = zipSync({ 'SKILL.md': strToU8(skill.replace('工作步骤', '新工作步骤')), 'new.md': strToU8('新') })
    await expect(store.import('a', zip)).rejects.toMatchObject({ code: 'duplicate' })
    await store.import('a', zip, first.revision)
    const item = await store.read('a', first.name)
    expect(await readdir(item.directory)).toContain('new.md')
    expect(await readdir(item.directory)).not.toContain('old.md')
    await expect(store.import('a', zip, first.revision)).rejects.toMatchObject({ code: 'conflict' })
  })
})
