/** 员工个人技能的本机存储与 ZIP 校验。 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile, lstat } from 'node:fs/promises'
import { resolve, sep, dirname, join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { parse, stringify } from 'yaml'

import { SkillError, parseSkill, validateSkillArchive, type Limits } from './archive.ts'
export { SkillError, type Limits } from './archive.ts'
/** 渲染层可见的技能元数据。 */
export interface PersonalSkill {
  name: string
  description: string
  invocationName: string
  version: string
  enabled: boolean
  revision: string
  userInvocable: boolean
  error?: boolean
}
function child(root: string, name: string): string {
  const path = resolve(root, name)
  if (!path.startsWith(resolve(root) + sep)) throw new SkillError('archive')
  return path
}

/** 将已校验的 ZIP 原子保存到员工独立目录；同名导入拒绝覆盖。 */
export class PersonalSkills {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly root: string, private readonly limits: Limits) {}
  private employeeRoot(employee: string): string { return child(this.root, createHash('sha256').update(employee).digest('hex')) }
  /** 列出员工在本机保存的技能。 @param employee - 当前已激活员工标识。 @returns 技能摘要。 */
  async list(employee: string): Promise<PersonalSkill[]> {
    const root = this.employeeRoot(employee)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const entries = await readdir(root, { withFileTypes: true })
    const result: PersonalSkill[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) { console.warn('个人技能目录包含非技能条目：%s', entry.name); continue }
      try {
        const item = await this.read(employee, entry.name)
        result.push(this.summary(item))
      } catch (error) {
        console.warn('个人技能无法读取：%s', entry.name, error instanceof Error ? error.name : 'unknown')
        result.push({ name: entry.name, description: '', invocationName: `my-${entry.name}`, version: '', enabled: false, revision: '', userInvocable: false, error: true })
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }
  /** 读取员工自己的完整技能。 @param employee - 员工标识。 @param name - 包内名称。 @returns 技能正文及资源目录。 */
  async read(employee: string, name: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new SkillError('metadata')
    const directory = child(this.employeeRoot(employee), name)
    if ((await lstat(directory)).isSymbolicLink()) throw new SkillError('archive')
    const path = join(directory, 'SKILL.md')
    if ((await lstat(path)).isSymbolicLink()) throw new SkillError('archive')
    const source = await readFile(path, 'utf8')
    const value = parseSkill(source)
    if (value.name !== name) throw new SkillError('metadata')
    return { ...value, directory, path, source, revision: createHash('sha256').update(source).digest('hex') }
  }
  private summary(item: Awaited<ReturnType<PersonalSkills['read']>>): PersonalSkill {
    return { name: item.name, description: item.description, invocationName: `my-${item.name}`, version: item.version,
      enabled: item.enabled, revision: item.revision, userInvocable: item.invocation.userInvocable }
  }
  /** 原子编辑定义，保留包内资源和额外元数据，拒绝覆盖并发修改。
   * @param employee - 员工。
   * @param name - 固定技能标识。
   * @param input - 用户确认的内容。
   * @param revision - 编辑时的内容摘要。
   * @returns 更新后的目录项。
   */
  update(employee: string, name: string,
    input: { description: string; instructions: string; version: string; enabled: boolean }, revision: string): Promise<PersonalSkill> {
    const job = this.queue.then(async () => {
      const prior = await this.read(employee, name)
      if (prior.revision !== revision) throw new SkillError('conflict')
      const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(prior.source)?.[1]
      const metadata: unknown = parse(frontmatter ?? '')
      const source = `---\n${stringify({ ...metadata && typeof metadata === 'object' ? metadata : {}, name,
        description: input.description, version: input.version, 'lfclaw-enabled': input.enabled })}---\n${input.instructions.trim()}\n`
      parseSkill(source)
      const temporary = child(prior.directory, `.SKILL-${randomUUID()}.tmp`)
      try { await writeFile(temporary, source, { flag: 'wx', mode: 0o600 }); await rename(temporary, prior.path) }
      finally { await rm(temporary, { force: true }) }
      return this.summary(await this.read(employee, name))
    })
    this.queue = job.catch(() => { /* 失败由接口报告，不阻塞后续操作。 */ })
    return job
  }
  /** 保存对话确认的个人技能。 @param employee - 员工标识。 @param input - 名称、描述和正文。 @returns 保存后的元数据。 */
  create(employee: string, input: { name: string; description: string; instructions: string }): Promise<PersonalSkill> {
    const text = `---\n${stringify({ name: input.name, description: input.description })}---\n${input.instructions.trim()}\n`
    return this.import(employee, zipSync({ 'SKILL.md': strToU8(text) }))
  }
  /** 校验并保存 ZIP，不执行包内脚本。 @param employee - 员工标识。 @param bytes - ZIP 文件。 @returns 导入后的元数据。 */
  import(employee: string, bytes: Uint8Array, revision?: string): Promise<PersonalSkill> {
    const job = this.queue.then(() => this.writeArchive(employee, bytes, revision))
    this.queue = job.catch(() => { /* 失败已返回调用方，后续导入仍可执行。 */ })
    return job
  }
  /** 卸载当前员工的个人技能。 @param employee - 当前员工标识。 @param name - 包内规范名称。 @returns 卸载完成，已不存在时仍成功。 */
  remove(employee: string, name: string): Promise<void> {
    const job = this.queue.then(async () => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new SkillError('metadata')
      const directory = child(this.employeeRoot(employee), name)
      try { const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SkillError('archive') }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error }
      const removed = child(this.employeeRoot(employee), `.removed-${randomUUID()}`)
      await rename(directory, removed)
      try { await rm(removed, { recursive: true }) }
      catch (error) { console.warn('LFClaw 个人技能已卸载，暂存文件清理失败：', error instanceof Error ? error.name : 'unknown') }
    })
    this.queue = job.catch(() => { /* 调用方显示卸载错误，后续操作仍可继续。 */ })
    return job
  }
  private async writeArchive(employee: string, bytes: Uint8Array, revision?: string): Promise<PersonalSkill> {
    const { files, prefix, parsed } = validateSkillArchive(bytes, this.limits)
    const root = this.employeeRoot(employee)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const destination = child(root, parsed.name)
    let replacing = false
    try {
      await lstat(destination)
      if (!revision) throw new SkillError('duplicate')
      if ((await this.read(employee, parsed.name)).revision !== revision) throw new SkillError('conflict')
      replacing = true
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      if (revision) throw new SkillError('conflict')
    }
    const staging = child(root, `.import-${randomUUID()}`)
    await mkdir(staging, { mode: 0o700 })
    try {
      for (const [name, data] of Object.entries(files)) {
        const target = child(staging, name.slice(prefix.length))
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, data, { flag: 'wx', mode: 0o600 })
      }
      if (replacing) {
        const previous = child(root, `.previous-${randomUUID()}`)
        await rename(destination, previous)
        try { await rename(staging, destination) }
        catch (error) { await rename(previous, destination); throw error }
        try { await rm(previous, { recursive: true }) }
        catch (error) { console.warn('个人技能已更新，旧包清理待重试：', error instanceof Error ? error.name : 'unknown') }
      } else await rename(staging, destination)
    } finally { await rm(staging, { recursive: true, force: true }) }
    return this.summary(await this.read(employee, parsed.name))
  }
}
