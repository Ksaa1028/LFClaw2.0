import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zipSync, strToU8 } from 'fflate'
import { skillDescription } from '../src/skill-archive.ts'
import { skillArchiveLimits } from './skill-limits.ts'
const valid = '---\nname: report-helper\ndescription: 日报\n---\n生成日报\n'
test('企业发布使用安装端规则，拒绝缺名称、空正文、不合法调用标志和目录冲突', () => {
  assert.equal(skillDescription(zipSync({ 'wrapper/SKILL.md': strToU8(valid) }), skillArchiveLimits), '日报')
  for (const source of [valid.replace('name: report-helper\n', ''), valid.replace('生成日报', ''), valid.replace('description:', 'user-invocable: nope\ndescription:')]) {
    assert.throws(() => skillDescription(zipSync({ 'SKILL.md': strToU8(source) }), skillArchiveLimits))
  }
  for (const path of ['CON.txt', '/outside.txt', '../outside.txt', 'x\\bad.txt']) {
    assert.throws(() => skillDescription(zipSync({ 'wrapper/SKILL.md': strToU8(valid), [path]: strToU8('x') }), skillArchiveLimits))
  }
})

test('企业发布读取主技能描述，允许原样附带子技能指南', () => {
  const nested = valid.replace('name: report-helper', 'name: nested-helper').replace('description: 日报', 'description: 子技能')
  assert.equal(skillDescription(zipSync({
    'wrapper/skills/nested/SKILL.md': strToU8(nested),
    'wrapper/SKILL.md': strToU8(valid),
  }), skillArchiveLimits), '日报')
  assert.throws(() => skillDescription(zipSync({
    'a/SKILL.md': strToU8(valid), 'b/SKILL.md': strToU8(nested),
  }), skillArchiveLimits))
})

test('技能体积和条目限制由部署配置决定，超限时仍拒绝', () => {
  const files = { 'SKILL.md': strToU8(valid), ...Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`templates/${index}.svg`, strToU8('模板')])) }
  const archive = zipSync(files)
  const expanded = Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0)
  const exact = { maxArchiveBytes: archive.length, maxUnpackedBytes: expanded, maxFiles: 202 }
  assert.equal(skillDescription(archive, exact), '日报')
  assert.equal(skillDescription(archive, skillArchiveLimits), '日报')
  for (const limit of [
    { ...exact, maxArchiveBytes: archive.length - 1 },
    { ...exact, maxUnpackedBytes: expanded - 1 },
    { ...exact, maxFiles: 201 },
  ]) assert.throws(() => skillDescription(archive, limit))
})
