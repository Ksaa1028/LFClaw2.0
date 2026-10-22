import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '../src/index.ts'
import { meta } from '../../session-persistence/tests/contract.ts'
const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture(root?: string) {
  if (!root) { root = await mkdtemp(join(tmpdir(), 'lfclaw-delete-session-')); roots.push(root) }
  const ctx = new Context(); contexts.push(ctx)
  const persistence = new JsonlSessionPersistence(ctx, { root, compression: 'none' })
  return { root, persistence }
}
it('删除关闭的会话后，重启仍不可列出、读取或重用同一标识', async () => {
  const { root, persistence } = await fixture()
  const id = SessionId('delete-me')
  const handle = await persistence.create(meta(id, root))
  await handle.flush(); await handle.close()
  await persistence.delete(id)
  const restarted = (await fixture(root)).persistence
  expect(await restarted.list()).toEqual([])
  expect(await restarted.stat(id)).toBeUndefined()
  await expect(restarted.open(id, 'read')).rejects.toThrow()
  await expect(restarted.create(meta(id, join(root, 'another-project')))).rejects.toThrow()
  await expect(restarted.delete(id)).resolves.toBeUndefined()
})
it('拒绝删除尚在使用的句柄；其他会话不受影响', async () => {
  const { root, persistence } = await fixture()
  const first = await persistence.create(meta('first', root))
  const second = await persistence.create(meta('second', root))
  await first.flush(); await second.flush()
  await expect(persistence.delete(first.id)).rejects.toThrow()
  await first.close(); await persistence.delete(first.id)
  expect((await persistence.list()).map(row => row.header.id)).toEqual([second.id])
  await second.close()
})
it('其他后端实例持有写锁时拒绝删除，释放后可删', async () => {
  const { root, persistence } = await fixture()
  const writer = await persistence.create(meta('locked', root))
  await writer.flush()
  const other = (await fixture(root)).persistence
  await expect(other.delete(writer.id)).rejects.toThrow()
  await writer.close()
  await other.delete(writer.id)
  expect(await persistence.stat(writer.id)).toBeUndefined()
})
