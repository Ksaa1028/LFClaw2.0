import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resourceOperationSummary } from '../src/operation-summary.ts'

test('新增和删除记录保留操作时的资源名称，专家团单独命名', () => {
  assert.equal(resourceOperationSummary('skills', 'create', { id: 's1', name: '销售助手' }), '已新增技能「销售助手」')
  assert.equal(resourceOperationSummary('skills', 'delete', { id: 's1', name: '销售助手' }), '已删除技能「销售助手」')
  assert.equal(resourceOperationSummary('experts', 'create', { id: 't1', name: '营运团队', source: 'team' }), '已新增专家团「营运团队」')
})

test('修改记录说明更名、启停和改动字段，不保存密钥或配置内容', () => {
  const before = { id: 'm1', name: '旧模型', enabled: true, apiKey: 'old-secret', baseUrl: 'https://old.invalid/secret' }
  const after = { ...before, name: '新模型', enabled: false, apiKey: 'new-secret', baseUrl: 'https://new.invalid/secret' }
  const summary = resourceOperationSummary('models', 'update', after, before)
  assert.equal(summary, '已修改模型「新模型」：名称由「旧模型」改为「新模型」；停用；修改接口地址、访问密钥')
  assert.equal(summary.includes('secret'), false)
  assert.equal(resourceOperationSummary('employees', 'update', { id: 'e1', name: '张三', status: 'inactive' },
    { id: 'e1', name: '张三', status: 'active' }), '已修改员工「张三」：停用员工')
  assert.equal(resourceOperationSummary('skills', 'update', { id: 's1', name: '技能', scope: 'department', scopeTarget: ['d1'] },
    { id: 's1', name: '技能', scope: 'all', scopeTarget: [] }), '已修改技能「技能」：修改授权范围、授权对象')
  assert.equal(resourceOperationSummary('skills', 'update', { id: 's1', name: '技能', extension: 'secret-value' },
    { id: 's1', name: '技能' }), '已修改技能「技能」：修改其他配置')
})

test('重复保存与缺少修改前记录分别说明，不推测缺失的明细', () => {
  const item = { id: 's1', name: '技能', enabled: true }
  assert.equal(resourceOperationSummary('skills', 'update', item, item), '已保存技能「技能」（展示配置未发生变化）')
  assert.equal(resourceOperationSummary('skills', 'update', item), '已修改技能「技能」（修改明细未记录）')
})
