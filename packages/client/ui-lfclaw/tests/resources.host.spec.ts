import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { expertManagerInstructions } from '../src/expert-manager-skill.ts'

it('preserves the supplied WorkBuddy archive and ships the same adapted skill used by the runtime', () => {
  const root = new URL('../../../../LFClaw/09-资源/技能/专家管理/', import.meta.url)
  expect(createHash('sha256').update(readFileSync(new URL('参考原包/expert-manager.zip', root))).digest('hex'))
    .toBe('9e526425cb811f3e92d5276a0ecb71ced1aaa258dbb9acf907fd7d229ea0e14c')
  const files = unzipSync(readFileSync(new URL('专家管理.zip', root)))
  expect(Object.keys(files).sort()).toEqual(['lfclaw-expert-manager/LICENSE.txt', 'lfclaw-expert-manager/NOTICE.md', 'lfclaw-expert-manager/SKILL.md'])
  const skill = strFromU8(files['lfclaw-expert-manager/SKILL.md']!)
  expect(skill).toContain('name: lfclaw-expert-manager')
  expect(skill.endsWith(expertManagerInstructions)).toBe(true)
  expect(strFromU8(files['lfclaw-expert-manager/LICENSE.txt']!)).toContain('Apache License')
})
