/** Locale-owned sharing and synchronized notification copy. */
export const sharingZh = {
  pagination: '消息分页', previousPage: '上一页', nextPage: '下一页', pageNumber: '第 {current} / {total} 页',
  receipt: '「{title}」由 {name} 于 {time} 分享', continuation: '以上为分享的原始记录，以下内容保存在你的独立会话中',
  panel: '消息通知', share: '分享会话', shareTitle: '分享「{title}」',
  hint: '完整聊天、上传附件及 AI 输出文件将临时上传到企业服务器，仅所选员工可领取',
  search: '搜索员工或部门', send: '发送分享', cancel: '取消', close: '关闭',
  emptyEmployees: '没有匹配的员工', selected: '已选择 {count} 人', busy: '正在处理',
  failed: '操作失败，请刷新列表核对结果后重试', sent: '会话已分享',
  inboxTitle: '消息通知', inboxHint: '查看企业公告，领取同事分享的会话',
  refresh: '刷新', announcementTab: '企业公告', shareTab: '同事分享',
  emptyAnnouncements: '暂无企业公告', emptyShares: '暂无同事分享',
  from: '来自 {name}', announcementTime: '发布时间：{time}',
  received: '分享时间：{time}', expires: '保留至：{time}', expired: '已过期',
  claim: '领取并打开', read: '标为已读', readStatus: '已读', unreadStatus: '未读', remove: '删除消息',
  deleteShareTitle: '删除分享消息', deleteShareDescription: '删除「{title}」这条分享消息？已领取的会话会保留。', confirmDelete: '确认删除',
  unreadCount: '{count} 条未读', limits: '上限 {size} MB，保留 {days} 天',
}
/** English sharing copy. */
export const sharingEn: Record<keyof typeof sharingZh, string> = {
  pagination: 'Message pages', previousPage: 'Previous', nextPage: 'Next', pageNumber: 'Page {current} of {total}',
  receipt: '“{title}” shared by {name} on {time}', continuation: 'Shared history ends here. New content is saved in your separate local conversation.',
  panel: 'Notifications', share: 'Share conversation', shareTitle: 'Share “{title}”',
  hint: 'The complete conversation, uploads and AI output files will be temporarily stored on the enterprise server for selected employees.',
  search: 'Search employees or departments', send: 'Send share', cancel: 'Cancel', close: 'Close',
  emptyEmployees: 'No matching employees', selected: '{count} selected', busy: 'Processing',
  failed: 'Operation failed. Refresh the list to check the result before retrying.', sent: 'Conversation shared',
  inboxTitle: 'Notifications', inboxHint: 'Read company announcements and claim conversations shared by colleagues.',
  refresh: 'Refresh', announcementTab: 'Company announcements', shareTab: 'Shared by colleagues',
  emptyAnnouncements: 'No company announcements', emptyShares: 'No shared conversations',
  from: 'From {name}', announcementTime: 'Published: {time}',
  received: 'Shared: {time}', expires: 'Available until: {time}', expired: 'Expired',
  claim: 'Claim and open', read: 'Mark read', readStatus: 'Read', unreadStatus: 'Unread', remove: 'Delete message',
  deleteShareTitle: 'Delete shared message', deleteShareDescription: 'Delete the shared message “{title}”? Conversations you already claimed will remain.', confirmDelete: 'Delete message',
  unreadCount: '{count} unread', limits: 'Limit {size} MB; retained {days} days',
}
/** Typed sharing namespace keys. */
export type SharingKey = keyof typeof sharingZh
