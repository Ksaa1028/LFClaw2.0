/** 选中技能的可读草稿与唯一调用引用。 */
import type { StartSessionOptions } from '@deepseek-ai/dsh-client-ui-workspace/client'

/**
 * 创建会话草稿，界面显示原名，发送时引用展开为唯一调用标识。
 * @param name - 展示名称。
 * @param invocationName - Host 技能目录中的唯一名称。
 * @returns 可恢复的结构化草稿。
 */
export function skillDraft(name: string, invocationName: string): NonNullable<StartSessionOptions['prompt']> {
  const ref = `/${invocationName}`
  return { text: `${ref} `, references: [{ source: 'skill', ref, label: name, clipboardText: ref, offset: 0, length: ref.length }] }
}
