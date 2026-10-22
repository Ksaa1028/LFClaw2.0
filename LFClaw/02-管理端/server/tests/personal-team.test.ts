import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '../src/store.ts'
import { PersonalTeamError, resolvePersonalTeam } from '../src/personal-team.ts'
const employee = { id: 'e1' }
const definition = (name: string) => ({ name, description: '', instructions: '分析并核对依据', tags: [], kind: 'expert', memberIds: [], skillIds: [], connectorIds: [], quickPrompts: [] })

test('无需预建成员，整组创建；复用成员不被修改并保持执行顺序', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-team-'))
  try {
    const store = new JsonStore(join(directory, 'db.json'))
    const input = { team: { ...definition('团'), kind: 'team', memberIds: ['new:b', 'new:a'] },
      newMembers: [{ key: 'a', definition: definition('研究') }, { key: 'b', definition: definition('审阅') }] }
    const result = store.update(db => {
      const result = resolvePersonalTeam(input, db, employee)
      assert.equal(db.personalExperts.length, 0)
      db.personalExperts.push(...result.members, result.team)
      return result
    })
    assert.equal(store.read().personalExperts.length, 3)
    assert.deepEqual(result.team.memberIds, [result.members[1]!.id, result.members[0]!.id])
    const db = store.read(), before = structuredClone(db)
    const mixed = resolvePersonalTeam({ team: { ...input.team, memberIds: [result.members[0]!.id, 'new:c'] }, newMembers: [{ key: 'c', definition: definition('执行') }] }, db, employee)
    assert.equal(mixed.members.length, 1)
    assert.deepEqual(db, before)
    const reused = resolvePersonalTeam({ team: { ...input.team, memberIds: result.team.memberIds }, newMembers: [] }, db, employee)
    assert.equal(reused.members.length, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('成员不存在、越权、重复、嵌套、依赖失效或遗漏时不留下任何半成品', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-team-invalid-'))
  try {
    const store = new JsonStore(join(directory, 'db.json'))
    store.update(db => { db.personalExperts.push({ ...definition('他人'), id: 'other', ownerEmployeeId: 'e2' }, { ...definition('旧团'), id: 'nested', ownerEmployeeId: 'e1', kind: 'team', memberIds: ['a', 'b'] }) })
    const before = store.read()
    const team = { ...definition('团'), kind: 'team', memberIds: ['new:a', 'new:b'] }
    const a = { key: 'a', definition: definition('研究') }, b = { key: 'b', definition: definition('审阅') }
    for (const input of [
      { team, newMembers: [a, { ...b, definition: { ...b.definition, instructions: '' } }] },
      { team, newMembers: [a, a] },
      { team, newMembers: [a, { ...b, definition: { ...b.definition, kind: 'team' } }] },
      { team, newMembers: [a, { ...b, definition: { ...b.definition, skillIds: ['missing'] } }] },
      { team: { ...team, memberIds: ['new:a', 'missing'] }, newMembers: [a] },
      { team: { ...team, memberIds: ['new:a', 'other'] }, newMembers: [a] },
      { team: { ...team, memberIds: ['new:a', 'nested'] }, newMembers: [a] },
      { team: { ...team, memberIds: ['new:a', 'new:a'] }, newMembers: [a] },
      { team: { ...team, memberIds: ['new:a', 'missing'] }, newMembers: [a, b] },
    ]) {
      assert.throws(() => store.update(db => { const result = resolvePersonalTeam(input, db, employee); db.personalExperts.push(...result.members, result.team) }), PersonalTeamError)
      assert.deepEqual(store.read(), before)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
