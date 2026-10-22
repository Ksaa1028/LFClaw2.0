/** 会话删除文案。 */
export const zh = {
  delete: '删除会话', title: '删除此会话？',
  description: '删除“{title}”后，将无法在应用中查看或继续该会话。运行中的任务会停止，工作区文件不会删除。',
  cancel: '取消', confirm: '确认删除', busy: '正在删除', failed: '删除未完成，请刷新列表后重试',
  success: '会话已删除', close: '关闭',
}
/** 删除文案键。 */
export type SessionActionsKey = keyof typeof zh
/** 英文删除文案。 */
export const en: Record<SessionActionsKey, string> = {
  delete: 'Delete conversation', title: 'Delete this conversation?',
  description: 'You will no longer be able to view or continue “{title}” in the app. Running tasks will stop. Workspace files are preserved.',
  cancel: 'Cancel', confirm: 'Delete', busy: 'Deleting', failed: 'Deletion did not complete. Refresh and retry.',
  success: 'Conversation deleted', close: 'Close',
}
