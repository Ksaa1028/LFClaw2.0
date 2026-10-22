import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { validateSkillArchive } from '../src/archive.ts'

const limits = { maxArchiveBytes: 10240, maxUnpackedBytes: 20480, maxFiles: 10 }
const main = strToU8('---\nname: main-skill\ndescription: 主技能\n---\n读取子技能指南\n')
const nested = strToU8('---\nname: nested-skill\ndescription: 子技能\n---\n子技能步骤\n')

describe('技能包主入口', () => {
  it.each(['', 'wrapper/', 'outer/wrapper/'])('从 %s 选择主入口，保留先出现的深层子技能', (prefix) => {
    const files = {
      [`${prefix}skills/nested/SKILL.md`]: nested,
      [`${prefix}SKILL.md`]: main,
      [`${prefix}references/guide.md`]: strToU8('资料'),
    }
    const result = validateSkillArchive(zipSync(files), limits)
    expect(result.prefix).toBe(prefix)
    expect(result.parsed).toMatchObject({ name: 'main-skill', description: '主技能' })
    expect(result.files).toEqual(files)
  })

  it('拒绝并列主入口，不因 ZIP 条目顺序选择其中一个', () => {
    for (const paths of [['a/SKILL.md', 'b/SKILL.md'], ['b/SKILL.md', 'a/SKILL.md']]) {
      expect(() => validateSkillArchive(zipSync(Object.fromEntries(paths.map(path => [path, main]))), limits))
        .toThrow(expect.objectContaining({ code: 'metadata' }))
    }
  })

  it('拒绝没有入口的包，以及主目录之外的文件或更深入口', () => {
    expect(() => validateSkillArchive(zipSync({ 'guide.md': main }), limits))
      .toThrow(expect.objectContaining({ code: 'metadata' }))
    for (const outside of ['other/guide.md', 'other/skills/nested/SKILL.md']) {
      expect(() => validateSkillArchive(zipSync({ 'main/SKILL.md': main, [outside]: nested }), limits))
        .toThrow(expect.objectContaining({ code: 'archive' }))
    }
  })

  it('主入口无效时不改用有效的子技能入口', () => {
    expect(() => validateSkillArchive(zipSync({
      'wrapper/SKILL.md': strToU8('# 缺少元数据'),
      'wrapper/skills/nested/SKILL.md': nested,
    }), limits)).toThrow(expect.objectContaining({ code: 'metadata' }))
  })
})
