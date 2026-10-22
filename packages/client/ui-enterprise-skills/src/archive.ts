/** 企业发布与员工安装共用的技能包校验。 */
import { unzipSync, strFromU8 } from 'fflate'
import { parse } from 'yaml'
/** 导入限制由部署配置提供。 */
export interface Limits {
  /** Maximum accepted compressed archive size in bytes. */
  maxArchiveBytes: number
  /** Maximum total uncompressed file size in bytes. */
  maxUnpackedBytes: number
  /** Maximum number of files accepted in one skill archive. */
  maxFiles: number
}
/** 可预期的文件或元数据错误。 */
export class SkillError extends Error {
  constructor(readonly code: 'archive' | 'metadata' | 'duplicate' | 'conflict') { super(code) }
}

/** 解析并校验 SKILL.md。
 * @param text - 完整文档。
 * @returns 元数据和正文。
 */
export function parseSkill(text: string): {
  name: string
  description: string
  content: string
  version: string
  enabled: boolean
  invocation: { modelInvocable: boolean; userInvocable: boolean }
} {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text)
  const frontmatter = match?.[1], content = match?.[2]
  if (!frontmatter || !content?.trim()) throw new SkillError('metadata')
  let value: unknown
  try { value = parse(frontmatter, { maxAliasCount: 0 }) } catch (_error) { throw new SkillError('metadata') }
  if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name) || value.name.length > 60 ||
    !('description' in value) || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 2000) throw new SkillError('metadata')
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (key in value && typeof Reflect.get(value, key) !== 'boolean') throw new SkillError('metadata')
  }
  const version: unknown = Reflect.get(value, 'version')
  const enabled: unknown = Reflect.get(value, 'lfclaw-enabled')
  if (version !== undefined && !(typeof version === 'number' && Number.isFinite(version))
    && (typeof version !== 'string' || !version.trim() || version.length > 64)) throw new SkillError('metadata')
  if (enabled !== undefined && typeof enabled !== 'boolean') throw new SkillError('metadata')
  return { name: value.name, description: value.description.trim(), content,
    version: typeof version === 'string' || typeof version === 'number' ? String(version) : '1.0.0', enabled: enabled !== false, invocation: {
      modelInvocable: Reflect.get(value, 'disable-model-invocation') !== true,
      userInvocable: Reflect.get(value, 'user-invocable') !== false,
    } }
}

function safeName(path: string): boolean {
  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..' &&
    !/[\\:\x00-\x1f<>"|?*]/.test(part) && !/[. ]$/.test(part) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

/** 校验技能 ZIP，以唯一最外层 SKILL.md 为主入口，保留其目录内的子技能和资源，不写入磁盘。
 * @param bytes - ZIP 字节。
 * @param limits - 部署限制。
 * @returns 已校验的文件、前缀与技能定义。
 */
export function validateSkillArchive(bytes: Uint8Array, limits: Limits): {
  files: Record<string, Uint8Array>
  prefix: string
  parsed: ReturnType<typeof parseSkill>
} {
  if (!bytes.length || bytes.length > limits.maxArchiveBytes) throw new SkillError('archive')
  let total = 0, count = 0
  const seen = new Set<string>()
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (file) => {
      if (++count > limits.maxFiles || (total += file.originalSize) > limits.maxUnpackedBytes) throw new SkillError('archive')
      const path = file.name.endsWith('/') ? file.name.slice(0, -1) : file.name
      if (!safeName(path) || seen.has(path.toLowerCase())) throw new SkillError('archive')
      seen.add(path.toLowerCase())
      return !file.name.endsWith('/')
    } })
  } catch (_error) { throw new SkillError('archive') }
  const names = Object.keys(files)
  const candidates = names.filter(name => name.split('/').at(-1) === 'SKILL.md')
  const depth = Math.min(...candidates.map(name => name.split('/').length))
  const roots = candidates.filter(name => name.split('/').length === depth)
  if (roots.length !== 1) throw new SkillError('metadata')
  const skillPath = roots[0]
  if (!skillPath) throw new SkillError('metadata')
  const prefix = skillPath.slice(0, -'SKILL.md'.length)
  if (names.some(name => !name.startsWith(prefix))) throw new SkillError('archive')
  const definition = files[skillPath]
  if (!definition) throw new SkillError('metadata')
  const parsed = parseSkill(strFromU8(definition))
  return { files, prefix, parsed }
}
