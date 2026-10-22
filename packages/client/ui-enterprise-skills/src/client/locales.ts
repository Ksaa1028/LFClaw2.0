/** 技能管理的界面文案。 */
export const zh = {
  edit: '对话修改', editPrompt: '请帮我修改已有的个人技能“{name}”。先读取它的当前内容，听我说明要改什么，再展示修改后的内容供我确认；确认后更新原技能，不要创建同名新技能。', loading: '正在准备', disabled: '已停用', notUserInvocable: '此技能仅供模型自动选用', importReplace: '替换同名技能', replaceConfirm: '已有同名技能，是否用该 ZIP 替换？原技能包资源也会替换。', metadataPending: '本机已保存，管理清单待同步',

  uninstall: '卸载技能', uninstallTitle: '卸载此个人技能？', uninstallDescription: '卸载“{name}”后，将从本机的个人技能目录移除。企业技能不受影响。',
  uninstallConfirm: '确认卸载', cancel: '取消', removing: '正在卸载', removeFailed: '卸载失败，请刷新后重试',
  versionBadge: 'v{version}',
  addSkill: '技能', addSkillDescription: '选择已授权的企业或个人技能', emptySkills: '暂无可用技能',
  title: '技能管理', subtitle: '让常用方法成为可复用的工作能力', enterprise: '企业技能', personal: '我的技能',
  import: '导入技能', create: '对话创建', refresh: '刷新列表', search: '搜索技能名称或描述', empty: '暂无企业授权技能', personalEmpty: '还没有个人技能，可导入 ZIP 或通过对话创建', noMatches: '没有匹配的技能',
  unavailable: '无法读取技能，请检查企业服务连接后重试', conflict: '技能已更新，请刷新后重试', archive: 'ZIP 无效或超出导入限制，请检查文件和目录',
  metadata: '请检查 SKILL.md：需包含有效的 name、description 和技能正文', duplicate: '已有同名个人技能，请修改包内名称后重新导入',
  version: '版本', use: '开始使用', busy: '正在导入',
  creationPrompt: '帮我创建一个个人技能。请先和我确认用途、输入和预期输出，整理好内容后由我确认保存。我的需求是：',
  openDetails: '查看 {name} 的详情', details: '查看详情', local: '本机保存', close: '关闭', about: '技能说明', ready: '可以使用', notReady: '暂不可用，请刷新重试',
  testHint: '点击“开始使用”后补充需求并发送，系统会按所选技能加载完整指令。',
} satisfies Record<string, string>
/** 文案键。 */
export type SkillCenterKey = keyof typeof zh
/** 英文界面文案。 */
export const en: Record<SkillCenterKey, string> = {
  edit: 'Edit in chat', editPrompt: 'Help me change my existing personal skill “{name}”. Read its current content first, ask what I want changed, and show me the revised content for confirmation. After I confirm, update the same skill without creating another one.', loading: 'Preparing', disabled: 'Disabled', notUserInvocable: 'This skill is available only for automatic model selection', importReplace: 'Replace skill', replaceConfirm: 'Replace the existing skill and its resources with this ZIP?', metadataPending: 'Saved locally; admin metadata sync is pending',

  uninstall: 'Uninstall skill', uninstallTitle: 'Uninstall this personal skill?', uninstallDescription: 'Remove “{name}” from your personal skills on this computer. Enterprise skills are preserved.',
  uninstallConfirm: 'Uninstall', cancel: 'Cancel', removing: 'Uninstalling', removeFailed: 'Could not uninstall. Refresh and retry.',
  versionBadge: 'v{version}',
  addSkill: 'Skill', addSkillDescription: 'Choose an authorized enterprise or personal skill', emptySkills: 'No available skills',
  title: 'Skills', subtitle: 'Turn working methods into reusable skills', enterprise: 'Enterprise skills', personal: 'My skills',
  import: 'Import ZIP', create: 'Create in chat', refresh: 'Refresh', search: 'Search skills', empty: 'No authorized enterprise skills', personalEmpty: 'Import a ZIP or create your first skill in chat', noMatches: 'No matching skills',
  unavailable: 'Cannot load skills. Check the enterprise connection and retry.', conflict: 'This skill has changed. Refresh and retry.', archive: 'Invalid ZIP or import limit exceeded. Check the files and paths.',
  metadata: 'SKILL.md requires a valid name, description and instructions.', duplicate: 'A personal skill with this name exists. Rename the skill and import again.', version: 'Version', use: 'Use skill', busy: 'Importing',
  creationPrompt: 'Help me create a personal skill. Discuss its purpose, inputs and expected outputs, then let me confirm before saving. My request: ',
  openDetails: 'View details for {name}', details: 'View details', local: 'Saved locally', close: 'Close', about: 'About this skill', ready: 'Ready to use', notReady: 'Unavailable. Refresh to retry.',
  testHint: 'Choose Use skill, add your request and send. The system loads the selected skill instructions.',
}
