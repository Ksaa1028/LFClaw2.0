/** 发布和客户端安装使用同一技能 ZIP 校验器。 */
import { SkillError, validateSkillArchive, type Limits } from '@deepseek-ai/dsh-client-ui-enterprise-skills/archive'
export type { Limits } from '@deepseek-ai/dsh-client-ui-enterprise-skills/archive'
/** 校验技能包。 @param archive - ZIP 内容。 @param limits - 部署配置的体积和条目限制。 @returns 包内技能描述。 */
export function skillDescription(archive: Uint8Array, limits: Limits): string {
  try { return validateSkillArchive(archive, limits).parsed.description }
  catch (error) { if (error instanceof SkillError) throw new Error(error.code === 'metadata' ? 'SKILL.md 需包含合法名称、描述和正文，调用标志须为布尔值' : 'ZIP 格式、路径或体积不符合要求'); throw error }
}
