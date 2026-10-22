/** 已授权企业技能的版本缓存、下载校验与加载。 */
import { createHash } from 'node:crypto'
import { PersonalSkills, type Limits } from './store.ts'

/** 服务端确认的授权包元数据。 */
export interface EnterpriseSkill { id: string; name: string; description: string; version: string; sha256: string; icon?: string }
/** 企业包缓存与个人技能分目录；版本由服务端内容摘要决定。 */
export class EnterpriseSkills {
  private readonly store: PersonalSkills
  private readonly pending = new Map<string, Promise<Awaited<ReturnType<PersonalSkills['read']>>>>()
  constructor(directory: string, limits: Limits, private readonly request: (path: string) => Promise<Response>) {
    this.store = new PersonalSkills(directory, limits)
    this.limit = limits.maxArchiveBytes
  }
  private readonly limit: number
  /**
   * 加载当前授权版本，缓存命中仍由调用方先确认授权。
   * @param employee - 企业接口确认的员工标识。
   * @param skill - 本次目录确认的版本与内容摘要。
   * @returns 校验后的指令和本机资源路径。
   */
  load(employee: string, skill: EnterpriseSkill): Promise<Awaited<ReturnType<PersonalSkills['read']>>> {
    const key = `${employee}\0${skill.id}\0${skill.sha256}`
    const prior = this.pending.get(key)
    if (prior) return prior
    const job = this.loadVersion(key, skill).finally(() => { this.pending.delete(key) })
    this.pending.set(key, job)
    return job
  }
  private async loadVersion(key: string, skill: EnterpriseSkill) {
    if (!/^[a-f0-9]{64}$/i.test(skill.sha256)) throw new Error('企业技能缺少有效的内容摘要')
    const cached = await this.store.list(key)
    if (cached.length > 1) throw new Error('企业技能缓存异常')
    const existing = cached[0]
    if (existing) return this.store.read(key, existing.name)
    const response = await this.request(`employee/skills/${encodeURIComponent(skill.id)}/download`)
    if (!response.ok || !response.body) throw new Error('企业技能下载失败或授权已变更')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > this.limit) throw new Error('企业技能包超出限制')
        chunks.push(value)
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    const bytes = Buffer.concat(chunks)
    if (createHash('sha256').update(bytes).digest('hex') !== skill.sha256) throw new Error('企业技能包内容校验失败')
    const imported = await this.store.import(key, bytes)
    return this.store.read(key, imported.name)
  }
}

/** 稳定的企业调用名称，不与个人或内置技能冲突。 @param id - 企业资源标识。 @param name - 包内规范名称。 @returns 企业技能调用名。 */
export function enterpriseInvocation(id: string, name: string): string {
  return `enterprise-${name}-${createHash('sha256').update(id).digest('hex').slice(0, 6)}`
}
