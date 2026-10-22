import { skillArchiveLimits } from './skill-limits.ts'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { createApp } from '../src/app.ts'
import { AuthService } from '../src/auth.ts'
import { createBackup, publicBackupArchive, restoreBackup } from '../src/backup.ts'
import { JsonStore, validateDatabase } from '../src/store.ts'
import { authorizationFor } from '../src/authorization.ts'
import { dashboardData } from '../src/dashboard.ts'
import { WeKnoraTimeoutError } from '../src/weknora.ts'

test('管理员鉴权、模型密钥隔离、员工激活及重置', async () => {
  const originalFetch = globalThis.fetch
  let upstreamModelId = ''
  let upstreamMaxTokens = 0
  let upstreamThinking: boolean | undefined
  let bailianAuthorization = ''
  let difyAuthorization = ''
  let difyMode = 'chat'
  let difyBody: Record<string, unknown> = {}
  let weknoraKey = ''
  let weknoraBody: Record<string, unknown> = {}
  let weknoraTimeout = false
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://weknora.example.com/api/v1/')) {
      if (weknoraTimeout) throw new WeKnoraTimeoutError('WeKnora 响应超时')
      weknoraKey = String(new Headers(init?.headers).get('X-API-Key'))
      if (String(input).endsWith('/sessions')) return Response.json({ success: true, data: { id: 'wk-session' } }, { status: 201 })
      weknoraBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('event: message\ndata: {"response_type":"answer","content":"WeKnora 回复"}\n\n'
        + 'event: message\ndata: {"response_type":"complete","done":true}\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
    }
    if (String(input).startsWith('https://api.dify.ai/v1/')) {
      difyAuthorization = String(new Headers(init?.headers).get('authorization'))
      if (String(input).endsWith('/info')) return Response.json({ name: 'Dify 专家', mode: difyMode })
      difyBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ event: 'message', answer: 'Dify 回复', conversation_id: 'dify-session' })
    }
    if (String(input).startsWith('https://dashscope.aliyuncs.com/api/v1/apps/')) {
      bailianAuthorization = String(new Headers(init?.headers).get('authorization'))
      return new Response(JSON.stringify({ output: { text: '百炼回复', session_id: 'remote-session' },
        usage: { input_tokens: 5, output_tokens: 3 } }),
      { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (!String(input).startsWith('https://model.invalid/')) return originalFetch(input, init)
    const requestBody = JSON.parse(String(init?.body)) as { max_tokens: number; model: string; enable_thinking?: boolean; messages: Array<{ content: string }> }
    upstreamModelId = requestBody.model
    upstreamMaxTokens = requestBody.max_tokens
    upstreamThinking = requestBody.enable_thinking
    const draft = requestBody.messages[0]?.content.includes('个人专家配置助手')
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: draft
      ? JSON.stringify({ name: '营运分析师', description: '分析营运数据', instructions: '先核对来源，再给出建议。', tags: ['营运'] })
      : 'OK' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }),
    { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-server-test-'))
  const store = new JsonStore(join(directory, 'db.json'))
  const lifetimes = { adminMs: 60_000, employeeMs: 120_000 }
  const auth = new AuthService(join(directory, 'admin-auth.json'), 'test-admin-password-123', lifetimes)
  const server = createApp({ skillArchiveLimits, store, auth, dataDirectory: directory, skillsDirectory: join(directory, 'skills'),
    allowedOrigin: 'http://127.0.0.1:5173', expertTimeoutMs: 30_000, modelTimeoutMs: 30_000, authWindowMs: 60_000, loginMaxFailures: 3,
    activationMaxFailures: 3 }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert(address && typeof address !== 'string')
    const root = `http://127.0.0.1:${address.port}`
    const request = (path: string, method: string, token?: string, body?: object) => fetch(root + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })

    assert.equal((await request('/api/admin/data', 'GET')).status, 401)
    assert.equal((await request('/api/admin/data/backups', 'POST', undefined, { id: 'fake-backup' })).status, 401)
    assert.equal((await request('/api/admin/login', 'POST', undefined, { username: 'admin', password: 'wrong' })).status, 401)
    const login = await request('/api/admin/login', 'POST', undefined, { username: 'admin', password: 'test-admin-password-123' })
    assert.equal(login.status, 200)
    const adminToken = (await login.json() as { token: string }).token
    const branding = { headline: '让想法落地，让工作轻松', badge: '企业版', showBadge: false }
    assert.equal((await request('/api/admin/branding', 'PUT', undefined, branding)).status, 401)
    for (const invalid of [{ ...branding, headline: '' }, { ...branding, headline: 'x'.repeat(41) },
      { ...branding, badge: 'x'.repeat(13) }, { ...branding, showBadge: 'false' },
      { ...branding, headline: '换\n行' }, { ...branding, badge: '', showBadge: true }]) {
      assert.equal((await request('/api/admin/branding', 'PUT', adminToken, invalid)).status, 400)
    }
    assert.equal((await request('/api/admin/branding', 'PUT', adminToken, branding)).status, 200)
    assert.deepEqual(await (await request('/api/branding', 'GET')).json(), branding)
    assert.deepEqual(new JsonStore(join(directory, 'db.json')).read().branding, branding)
    const systemStatus = await request('/api/admin/status', 'GET', adminToken)
    assert.equal(systemStatus.status, 200)
    assert.equal((await systemStatus.json() as { gatewayStatus: string }).gatewayStatus, 'online')
    assert.equal((await request('/api/admin/notifications', 'POST', undefined, { title: '维护', content: '今晚升级' })).status, 401)
    assert.equal((await request('/api/admin/notifications', 'POST', adminToken, { title: '维护', content: '今晚升级' })).status, 201)
    assert.equal((await request('/api/admin/data/backups', 'POST', adminToken, { id: 'fake-backup' })).status, 400)
    assert.equal((await request('/api/admin/data/versionPackages', 'POST', adminToken, { id: 'fake-version' })).status, 400)

    const department = await request('/api/admin/data/departments', 'POST', adminToken, { id: 'd1', name: '营运部' })
    assert.equal(department.status, 201)
    const backupResponse = await request('/api/admin/backups', 'POST', adminToken)
    assert.equal(backupResponse.status, 201)
    const backupId = (await backupResponse.json() as { id: string }).id
    assert.equal((await request(`/api/admin/backups/${backupId}/download`, 'GET', adminToken)).status, 200)
    assert.equal((await request('/api/admin/data/departments/d1', 'DELETE', adminToken)).status, 204)
    assert.equal(store.read().operationLogs.find(item => item.type === 'delete:departments')?.change, '已删除部门「营运部」')
    store.update(db => { db.branding = { headline: '临时文案', badge: '', showBadge: false } })
    assert.equal((await request(`/api/admin/backups/${backupId}/restore`, 'POST', adminToken)).status, 204)
    assert.equal(store.read().departments.length, 1)
    assert.deepEqual(store.read().branding, branding)
    const { branding: _branding, ...legacyDatabase } = store.read()
    assert.equal(validateDatabase(legacyDatabase).branding.headline, '让想法落地，让工作轻松')
    assert.throws(() => validateDatabase({ ...legacyDatabase, branding: { headline: 123 } }), { code: 'DATA_INVALID' })
    const disposable = await request('/api/admin/backups', 'POST', adminToken)
    assert.equal(disposable.status, 201)
    const disposableId = (await disposable.json() as { id: string }).id
    assert.equal((await request(`/api/admin/backups/${disposableId}`, 'DELETE')).status, 401)
    assert.equal((await request('/api/admin/backups/invalid', 'DELETE', adminToken)).status, 404)
    assert.equal((await request(`/api/admin/backups/${disposableId}`, 'DELETE', adminToken)).status, 204)
    assert.equal(existsSync(join(directory, 'backups', `${disposableId}.zip`)), false)
    assert.equal(new JsonStore(join(directory, 'db.json')).read().backups.some(item => item.id === disposableId), false)
    assert.equal((await request(`/api/admin/backups/${disposableId}/download`, 'GET', adminToken)).status, 404)
    assert.equal((await request(`/api/admin/backups/${disposableId}`, 'DELETE', adminToken)).status, 404)
    assert(store.read().operationLogs.some(item => item.type === 'delete:backups' && item.object === disposableId))
    const missingFile = await request('/api/admin/backups', 'POST', adminToken)
    const missingFileId = (await missingFile.json() as { id: string }).id
    unlinkSync(join(directory, 'backups', `${missingFileId}.zip`))
    assert.equal((await request(`/api/admin/backups/${missingFileId}`, 'DELETE', adminToken)).status, 204)
    assert.equal(store.read().backups.some(item => item.id === missingFileId), false)
    assert.equal((await request('/api/admin/data/departments', 'POST', adminToken, { id: 'd1', name: '重复' })).status, 409)
    assert(store.read().operationLogs.some(item => item.type === 'create:departments' && item.object === 'd1'))
    const employeeResponse = await request('/api/admin/data/employees', 'POST', adminToken, { id: 'e1', name: '员工', departmentId: 'd1', status: 'active', activationCode: 'attacker-code' })
    assert.equal(employeeResponse.status, 201)
    const employee = await employeeResponse.json() as { activationCode: string }
    assert.notEqual(employee.activationCode, 'attacker-code')
    assert.match(employee.activationCode, /^LF-YUANGONG-[0-9A-F]{8}$/)

    assert.equal((await request('/api/admin/data/models', 'POST', adminToken,
      { id: 'bad-price', name: '无效价格', pricePerMillionInput: 1 })).status, 400)
    const model = await request('/api/admin/data/models', 'POST', adminToken, { id: 'm1', name: '展示模型', upstreamModelId: 'provider-model-1', protocol: 'openai-compatible', baseUrl: 'https://model.invalid/v1', apiKey: 'secret-model-key', enabled: true, isDefault: true, scope: 'all', scopeTarget: [], pricePerMillionInput: 1, pricePerMillionOutput: 2, currency: 'CNY' })
    assert.equal(model.status, 201)
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken, {
      id: 'c1', name: '商场', type: 'mcp', apiKey: 'secret-connector-key', enabled: true, scope: 'all', scopeTarget: [],
      tools: [{ id: 'allowed', name: '可用', allowed: true }, { id: 'denied', name: '禁用', allowed: false }],
    })).status, 201)
    const genericConnector = { id: 'c-generic', name: '通用 MCP', type: 'mcp', endpoint: 'https://example.com/mcp',
      transport: 'streamable-http', authMode: 'headers', headers: { Authorization: 'Bearer connector-secret' },
      icon: 'data:image/png;base64,iVBORw0KGgo=', enabled: false, showToolsInClient: true,
      scope: 'all', scopeTarget: [], tools: [] }
    const genericCreated = await request('/api/admin/data/connectors', 'POST', adminToken, genericConnector)
    assert.equal(genericCreated.status, 201)
    assert.equal(store.read().connectors.find(item => item.id === 'c1')?.mallDataPermissions, false)
    const mallConnector = { id: 'c-mall', name: '商场 MCP', type: 'mcp', endpoint: 'https://example.com/sse2',
      transport: 'sse', authMode: 'mall', enabled: true, scope: 'all', scopeTarget: [], tools: [] }
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken, mallConnector)).status, 503)
    assert.equal(store.read().connectors.some(item => item.id === mallConnector.id), false)
    store.update(db => { db.connectors.push(mallConnector) })
    const renamed = { ...mallConnector, name: '改名后的连接器', authMode: undefined, mallDataPermissions: true }
    assert.equal((await request('/api/admin/data/connectors/c-mall', 'PUT', adminToken, renamed)).status, 200)
    assert.equal(store.read().connectors.find(item => item.id === 'c-mall')?.mallDataPermissions, true)
    assert.equal(store.read().connectors.find(item => item.id === 'c-mall')?.authMode, undefined)
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken,
      { ...mallConnector, id: 'c-mall-second' })).status, 409)
    assert.equal((await request('/api/admin/data/connectors/c-mall', 'PUT', adminToken,
      { ...renamed, mallDataPermissions: false })).status, 200)
    assert.equal(store.read().connectors.find(item => item.id === 'c-mall')?.mallDataPermissions, false)
    assert.equal((await request('/api/admin/data/connectors/c-mall', 'PUT', adminToken,
      { ...renamed, mallDataPermissions: 'true' })).status, 400)
    assert.deepEqual((await genericCreated.json() as { headers: Record<string, string> }).headers, { Authorization: '' })
    assert.equal((await request('/api/admin/data/connectors/c-generic', 'PUT', adminToken,
      { ...genericConnector, headers: { Authorization: '' } })).status, 200)
    assert.deepEqual(store.read().connectors.find(item => item.id === 'c-generic')?.headers,
      { Authorization: 'Bearer connector-secret' })
    assert.equal((await request('/api/admin/data/connectors/c-generic', 'PUT', adminToken,
      { ...genericConnector, endpoint: 'https://another.example.com/mcp', headers: { Authorization: '' } })).status, 400)
    assert.equal(store.read().connectors.find(item => item.id === 'c-generic')?.endpoint, genericConnector.endpoint)
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken,
      { ...genericConnector, id: 'bad-header', headers: { Host: 'example.com' } })).status, 400)
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken,
      { ...genericConnector, id: 'bad-transport', transport: 'stdio' })).status, 400)
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken,
      { id: 'invalid-scope', name: '无目标', enabled: true, scope: 'employee', scopeTarget: ['missing'], tools: [] })).status, 400)
    assert.equal((await request('/api/admin/data/connectors', 'POST', adminToken,
      { id: 'invalid-visibility', name: '无效展示', enabled: true, showToolsInClient: 'false', scope: 'all', scopeTarget: [], tools: [] })).status, 400)
    assert.equal((await request('/api/admin/data/connectors/c1', 'PUT', adminToken,
      { id: 'c1', name: '商场', enabled: true, scope: 'department', scopeTarget: ['missing'], tools: [] })).status, 400)
    assert.equal((await request('/api/admin/data/connectors/c1', 'PUT', adminToken,
      { id: 'c1', name: '商场', type: 'mcp', enabled: true, scope: 'employee', scopeTarget: ['e1'],
        tools: [{ id: 'allowed', name: '可用', allowed: true }, { id: 'denied', name: '禁用', allowed: false }] })).status, 200)
    assert.deepEqual(store.read().connectors[0]?.scopeTarget, ['e1'])
    assert.equal((await request('/api/admin/data/connectors/c1', 'PUT', adminToken,
      { id: 'c1', name: '商场', type: 'mcp', enabled: true, scope: 'all', scopeTarget: [],
        tools: [{ id: 'allowed', name: '可用', allowed: true }, { id: 'denied', name: '禁用', allowed: false }] })).status, 200)
    assert.equal((await model.json() as { apiKey: string }).apiKey, '')
    const allData = await (await request('/api/admin/data', 'GET', adminToken)).text()
    assert(!allData.includes('secret-model-key'))
    assert(!allData.includes('connector-secret'))
    assert(readFileSync(join(directory, 'db.json'), 'utf8').includes('secret-model-key'))
    const reopened = new JsonStore(join(directory, 'db.json')).read()
    assert.equal(reopened.departments[0]?.name, '营运部')
    assert.equal(reopened.employees[0]?.id, 'e1')
    assert.equal(reopened.models[0]?.id, 'm1')
    assert.equal(reopened.connectors[0]?.id, 'c1')
    assert.equal(reopened.connectors[0]?.showToolsInClient, true)
    assert.equal(reopened.notifications[0]?.title, '维护')

    const skillArchive = zipSync({
      'report/skills/nested/SKILL.md': strToU8('---\nname: nested\ndescription: 子技能说明\n---\n# 子技能\n'),
      'report/SKILL.md': strToU8('---\nname: report\ndescription: >-\n  自动生成\n  企业日报\n---\n# Report\n'),
    })
    const uploadBody = new FormData()
    uploadBody.append('file', new Blob([new Uint8Array(skillArchive)]), 'report.zip')
    const uploadResponse = await fetch(root + '/api/admin/skills/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: uploadBody,
    })
    assert.equal(uploadResponse.status, 201)
    const uploadedSkill = await uploadResponse.json() as { path: string; description: string }
    for (const collection of ['models', 'skills', 'connectors', 'experts'] as const) {
      const resource = { id: 'unassigned', name: '暂不分配', description: '', enabled: true,
        zipPath: uploadedSkill.path, scope: 'none', scopeTarget: [], source: 'dsh', instructions: '回答问题', tags: [], tools: [], version: '1.0.0',
        endpoint: 'https://connector.invalid/mcp', transport: 'streamable-http' }
      assert.equal((await request(`/api/admin/data/${collection}`, 'POST', adminToken, resource)).status, 201, collection)
      assert.equal((await request(`/api/admin/data/${collection}/unassigned`, 'PUT', adminToken, resource)).status, 200)
      const db = new JsonStore(join(directory, 'db.json')).read()
      const saved = db[collection].find(item => item.id === 'unassigned')!
      assert.equal(saved.scope, 'none')
      assert.deepEqual(saved.scopeTarget, [])
      assert.equal(authorizationFor({ ...saved, employeeOverrides: { e1: 'allow' } }, { id: 'e1' }, db).allowed, false)
      assert.equal((await request(`/api/admin/data/${collection}/unassigned`, 'DELETE', adminToken)).status, 204)
    }
    assert.equal(uploadedSkill.description, '自动生成 企业日报')
    const savedSkill = await request('/api/admin/data/skills', 'POST', adminToken,
      { id: 's1', name: '日报', zipPath: uploadedSkill.path, description: '不可信描述', enabled: true, source: 'enterprise', scope: 'all' })
    assert.equal(savedSkill.status, 201)
    assert.equal((await savedSkill.json() as { description: string }).description, uploadedSkill.description)
    assert.equal(new JsonStore(join(directory, 'db.json')).read().skills[0]?.description, uploadedSkill.description)
    assert.equal((await request('/api/admin/data/skills/s1', 'PUT', adminToken,
      { id: 's1', name: '新日报', zipPath: uploadedSkill.path, description: '仍不可信' })).status, 200)
    assert.equal(new JsonStore(join(directory, 'db.json')).read().skills[0]?.description, uploadedSkill.description)
    assert.equal(store.read().skills[0]?.version, '1')
    const invalidUpload = new FormData()
    invalidUpload.append('file', new Blob([new Uint8Array(zipSync({ 'SKILL.md': strToU8('---\nname: missing\n---\n') }))]), 'missing.zip')
    assert.equal((await fetch(root + '/api/admin/skills/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: invalidUpload,
    })).status, 400)

    const activation = await request('/api/employee/activate', 'POST', undefined, { code: employee.activationCode })
    assert.equal(activation.status, 200)
    const employeeToken = (await activation.json() as { token: string }).token
    const teamMember = { name: '临时成员', description: '', instructions: '核对', tags: [], kind: 'expert' }
    const teamRequest = { team: { ...teamMember, name: '整组创建', kind: 'team', memberIds: ['new:a', 'new:b'] },
      newMembers: [{ key: 'a', definition: teamMember }, { key: 'b', definition: teamMember }] }
    assert.equal((await request('/api/employee/personal-expert-teams', 'POST', adminToken, teamRequest)).status, 401)
    const teamBefore = store.read().personalExperts.length
    assert.equal((await request('/api/employee/personal-expert-teams', 'POST', employeeToken,
      { ...teamRequest, newMembers: [teamRequest.newMembers[0]] })).status, 400)
    assert.equal(store.read().personalExperts.length, teamBefore)
    const teamCreated = await request('/api/employee/personal-expert-teams', 'POST', employeeToken, teamRequest)
    assert.equal(teamCreated.status, 201)
    assert.equal(store.read().personalExperts.length, teamBefore + 3)
    const createdTeam = await teamCreated.json() as { team: { id: string }; members: Array<{ id: string }> }
    assert.equal((await request('/api/employee/experts/prepare', 'POST', employeeToken,
      { owner: 'personal', id: createdTeam.team.id })).status, 200)
    await request('/api/employee/personal-experts/' + createdTeam.team.id, 'DELETE', employeeToken)
    for (const member of createdTeam.members) await request('/api/employee/personal-experts/' + member.id, 'DELETE', employeeToken)

    assert.equal((await request('/api/employee/personal-connectors/check', 'POST', undefined, { url: 'https://example.com/sse2' })).status, 401)
    store.update(db => { db.connectors.find(item => item.id === 'c-mall')!.mallDataPermissions = true })
    assert.equal((await request('/api/employee/personal-connectors/check', 'POST', employeeToken, { url: 'https://example.com/another-path' })).status, 403)
    assert.equal((await request('/api/employee/personal-connectors/check', 'POST', employeeToken, { url: 'https://personal.example.com/mcp' })).status, 200)
    assert.equal((await request('/api/employee/personal-connectors/check', 'POST', employeeToken, { url: 'file:///data' })).status, 400)
    store.update(db => { db.connectors.find(item => item.id === 'c-mall')!.mallDataPermissions = false })
    const metadataReport = { employeeId: 'e1', deviceId: '00000000-0000-4000-a000-000000000001', skills: [
      { name: 'my-report', description: '整理日报', version: '1.0.0', source: 'personal', enabled: true },
    ] }
    assert.equal((await request('/api/employee/personal-skills/report', 'POST', undefined, metadataReport)).status, 401)
    assert.equal((await request('/api/employee/personal-skills/report', 'POST', employeeToken,
      { ...metadataReport, skills: [{ ...metadataReport.skills[0], instructions: '不允许上传正文' }] })).status, 400)
    assert.equal((await request('/api/employee/personal-skills/report', 'POST', employeeToken, metadataReport)).status, 204)
    assert.equal((await request('/api/admin/personal-skills', 'GET', employeeToken)).status, 401)
    const personalMetadata = await request('/api/admin/personal-skills', 'GET', adminToken).then(response => response.json()) as { ownerEmployeeId: string; skills: object[] }[]
    assert.equal(personalMetadata[0]?.ownerEmployeeId, 'e1')
    assert.equal(personalMetadata[0]?.skills.length, 1)
    assert.equal(JSON.stringify(personalMetadata).includes('instructions'), false)
    const invalidMetadataBackup = structuredClone(store.read())
    invalidMetadataBackup.personalSkillReports[0]!.skills = [{ ...metadataReport.skills[0], instructions: '备份不能绕过字段限制' }]
    assert.throws(() => store.replace(invalidMetadataBackup), /个人技能清单/)
    assert.equal(store.read().personalSkillReports[0]?.skills instanceof Array, true)
    assert.equal((await request('/api/employee/personal-skills/report', 'POST', employeeToken, { ...metadataReport, skills: [] })).status, 204)
    assert.equal(new JsonStore(store.path).read().personalSkillReports[0]?.skills instanceof Array, true)
    assert.deepEqual(new JsonStore(store.path).read().personalSkillReports[0]?.skills, [])

    assert.equal((await request('/api/employee/personal-experts/draft', 'POST', adminToken,
      { description: '创建一位营运分析专家' })).status, 401)
    assert.equal((await request('/api/employee/personal-experts/draft', 'POST', employeeToken,
      { description: '创建一位营运分析专家' })).status, 200)
    const personalCreate = await request('/api/employee/personal-experts', 'POST', employeeToken,
      { name: '我的营运顾问', description: '个人专家', instructions: '先检查数据。', tags: ['营运'], ownerEmployeeId: 'attacker' })
    assert.equal(personalCreate.status, 201)
    const personalId = (await personalCreate.json() as { id: string; ownerEmployeeId: string }).id
    assert.equal(store.read().personalExperts[0]?.ownerEmployeeId, 'e1')
    assert.equal(new JsonStore(join(directory, 'db.json')).read().personalExperts[0]?.id, personalId)
    assert(!(await request('/api/admin/data', 'GET', adminToken).then(response => response.text())).includes('我的营运顾问'))
    const secondEmployee = await request('/api/admin/data/employees', 'POST', adminToken,
      { id: 'e2', name: '第二员工', departmentId: 'd1', status: 'active' })
    const secondCode = (await secondEmployee.json() as { activationCode: string }).activationCode
    const secondActivation = await request('/api/employee/activate', 'POST', undefined, { code: secondCode })
    const secondToken = (await secondActivation.json() as { token: string }).token
    const announcementId = store.read().notifications[0]!.id
    const announcements = (token: string) => request('/api/employee/announcements', 'GET', token)
      .then(response => response.json()) as Promise<Array<{ id: string; title: string; content: string; read: boolean }>>
    assert.equal((await request('/api/employee/announcements', 'GET')).status, 401)
    assert.equal((await request('/api/employee/announcements', 'GET', adminToken)).status, 401)
    assert.equal((await announcements(employeeToken))[0]?.id, announcementId)
    assert.equal((await announcements(employeeToken))[0]?.title, '维护')
    assert.equal((await announcements(employeeToken))[0]?.content, '今晚升级')
    assert.equal((await announcements(employeeToken))[0]?.read, false)
    assert.equal((await request('/api/employee/announcements', 'POST', employeeToken,
      { id: announcementId, action: 'read' })).status, 204)
    assert.equal((await announcements(employeeToken))[0]?.read, true)
    assert.equal((await announcements(secondToken))[0]?.read, false)
    assert.equal((await request('/api/employee/announcements', 'POST', secondToken,
      { id: announcementId, action: 'delete' })).status, 204)
    assert.deepEqual(await announcements(secondToken), [])
    assert.equal((await announcements(employeeToken)).length, 1)
    assert.equal((await request('/api/employee/announcements', 'POST', employeeToken,
      { id: announcementId, action: 'unread' })).status, 204)
    assert.equal((await announcements(employeeToken))[0]?.read, false)
    assert.equal((await request('/api/employee/announcements', 'POST', employeeToken,
      { id: 'all', action: 'clear' })).status, 204)
    assert.deepEqual(await announcements(employeeToken), [])
    assert.equal(store.read().notifications.length, 1)
    assert.equal((await request('/api/employee/announcements', 'POST', employeeToken,
      { id: 'missing', action: 'read' })).status, 400)
    const recallResponse = await request('/api/admin/notifications', 'POST', adminToken,
      { title: '撤回测试', content: '所有员工收到后撤回' })
    assert.equal(recallResponse.status, 201)
    const recallId = (await recallResponse.json() as { id: string }).id
    assert.equal((await announcements(employeeToken))[0]?.id, recallId)
    assert.equal((await announcements(secondToken))[0]?.id, recallId)
    assert.equal((await request('/api/employee/announcements', 'POST', employeeToken,
      { id: recallId, action: 'read' })).status, 204)
    assert.equal((await announcements(employeeToken))[0]?.read, true)
    assert.equal((await request(`/api/admin/notifications/${recallId}/revoke`, 'POST', employeeToken)).status, 401)
    assert.equal((await request('/api/admin/notifications/missing/revoke', 'POST', adminToken)).status, 404)
    const recalled = await request(`/api/admin/notifications/${recallId}/revoke`, 'POST', adminToken)
    assert.equal(recalled.status, 200)
    const revokedAt = (await recalled.json() as { revokedAt: string }).revokedAt
    assert(Number.isFinite(Date.parse(revokedAt)))
    assert.deepEqual(await announcements(employeeToken), [])
    assert.deepEqual(await announcements(secondToken), [])
    const employeeAfterRecall = await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as { notifications: Array<{ id: string }> }
    assert(!employeeAfterRecall.notifications.some(item => item.id === recallId))
    assert.equal((await request('/api/employee/announcements', 'POST', employeeToken,
      { id: recallId, action: 'unread' })).status, 404)
    assert.equal(store.read().notifications.find(item => item.id === recallId)?.revokedAt, revokedAt)
    assert.equal(store.read().operationLogs.filter(item => item.type === 'revoke:notifications' && item.object === recallId).length, 1)
    assert.equal((await request(`/api/admin/notifications/${recallId}/revoke`, 'POST', adminToken)).status, 200)
    assert.equal(store.read().operationLogs.filter(item => item.type === 'revoke:notifications' && item.object === recallId).length, 1)
    const invalidRecallBackup = structuredClone(store.read())
    invalidRecallBackup.notifications.find(item => item.id === recallId)!.revokedAt = 'invalid'
    assert.throws(() => store.replace(invalidRecallBackup), /公告撤回时间格式错误/)
    assert.equal((await request(`/api/admin/notifications/${announcementId}`, 'DELETE', adminToken)).status, 409)
    assert.equal((await request(`/api/admin/notifications/${recallId}`, 'DELETE', employeeToken)).status, 401)
    assert.equal((await request('/api/admin/notifications/missing', 'DELETE', adminToken)).status, 404)
    assert.equal((await request(`/api/admin/notifications/${recallId}`, 'DELETE', adminToken)).status, 204)
    assert(!store.read().notifications.some(item => item.id === recallId))
    assert(!new JsonStore(join(directory, 'db.json')).read().notifications.some(item => item.id === recallId))
    const adminAfterDelete = await request('/api/admin/data', 'GET', adminToken).then(response => response.json()) as { notifications: Array<{ id: string }> }
    assert(!adminAfterDelete.notifications.some(item => item.id === recallId))
    assert.deepEqual(await announcements(employeeToken), [])
    assert.equal(store.read().operationLogs.filter(item => item.type === 'delete:notifications' && item.object === recallId).length, 1)
    assert.equal((await request(`/api/admin/notifications/${recallId}`, 'DELETE', adminToken)).status, 404)
    assert.equal(store.read().operationLogs.filter(item => item.type === 'delete:notifications' && item.object === recallId).length, 1)
    assert.deepEqual(await request('/api/employee/personal-experts', 'GET', secondToken).then(response => response.json()), [])
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'PUT', secondToken,
      { name: '夺取', description: '', instructions: '错误', tags: [] })).status, 404)
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'DELETE', secondToken)).status, 404)
    assert.equal((await request('/api/employee/experts/prepare', 'POST', adminToken,
      { owner: 'personal', id: personalId })).status, 401)
    assert.equal((await request('/api/employee/experts/prepare', 'POST', secondToken,
      { owner: 'personal', id: personalId })).status, 409)
    const personalUpdate = { name: '我的营运顾问', description: '个人专家', instructions: '先检查数据。',
      tags: ['营运'], skillIds: [], connectorIds: [], quickPrompts: ['复盘本周经营'] }
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'PUT', employeeToken, personalUpdate)).status, 200)
    assert.deepEqual(new JsonStore(store.path).read().personalExperts[0]?.quickPrompts, ['复盘本周经营'])
    const preparedPersonal = await request('/api/employee/experts/prepare', 'POST', employeeToken,
      { owner: 'personal', id: personalId })
    assert.equal(preparedPersonal.status, 200)
    assert.equal((await preparedPersonal.json() as { instructions: string }).instructions, '先检查数据。')
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'PUT', employeeToken,
      { ...personalUpdate, skillIds: ['duplicate', 'duplicate'] })).status, 400)
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'GET', secondToken)).status, 404)
    const readPersonal = await request(`/api/employee/personal-experts/${personalId}`, 'GET', employeeToken)
      .then(response => response.json()) as { revision: string }
    const conversationalUpdate = { ...personalUpdate, instructions: '先核对数据并复核。', expectedRevision: readPersonal.revision }
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'PUT', employeeToken, conversationalUpdate)).status, 200)
    assert.equal((await request(`/api/employee/personal-experts/${personalId}`, 'PUT', employeeToken,
      { ...conversationalUpdate, instructions: '旧会话覆盖' })).status, 409)
    assert.equal(store.read().personalExperts[0]?.instructions, '先核对数据并复核。')
    assert.equal((await request('/api/employee/personal-experts', 'POST', employeeToken,
      { ...personalUpdate, skillIds: ['not-authorized'] })).status, 400)
    assert.equal((await request('/api/employee/personal-experts', 'POST', secondToken,
      { ...personalUpdate, kind: 'team', memberIds: [personalId, 'another-private'] })).status, 400)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as {
      personalExperts: unknown[] }).personalExperts.length, 1)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { id: 'invalid-expert', name: '无效', description: '', tags: [], enabled: true,
        source: 'bailian', scope: 'all', scopeTarget: [], externalConfig: { appId: '', apiKey: '' } })).status, 400)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { id: 'expert-1', name: '百炼分析师', description: '分析经营数据', tags: ['分析'], enabled: true,
        source: 'bailian', scope: 'employee', scopeTarget: ['e1'],
        externalConfig: { appId: 'APP12345', apiKey: 'secret-bailian-key' } })).status, 201)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { id: 'expert-2', name: '写作专家', description: '写作', instructions: '按要求撰写。',
        tags: ['写作'], enabled: true, source: 'dsh', scope: 'employee', scopeTarget: ['e1'] })).status, 201)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { id: 'team-1', name: '营运专家团', description: '协作分析', instructions: '先分析后撰写。',
        tags: ['营运'], enabled: true, source: 'team', memberIds: ['expert-1', 'expert-2'],
        scope: 'employee', scopeTarget: ['e1'] })).status, 201)
    assert.equal((await request('/api/admin/data/experts/expert-2', 'DELETE', adminToken)).status, 409)
    const expertPermissions = await request('/api/admin/employees/e1/effective', 'GET', adminToken).then(response => response.json()) as {
      resources: Array<{ id: string; expertKind?: string; allowed: boolean }> }
    assert.equal(expertPermissions.resources.find(item => item.id === 'expert-1')?.expertKind, 'expert')
    assert.equal(expertPermissions.resources.find(item => item.id === 'team-1')?.expertKind, 'team')
    assert.equal(expertPermissions.resources.find(item => item.id === 'team-1')?.allowed, true)
    assert((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as {
      experts: Array<{ id: string }> }).experts.some(item => item.id === 'team-1'))
    const visibleExperts = await request('/api/admin/data', 'GET', adminToken).then(response => response.text())
    assert(!visibleExperts.includes('secret-bailian-key'))
    const preparedRemote = await request('/api/employee/experts/prepare', 'POST', employeeToken,
      { owner: 'enterprise', id: 'expert-1' })
    assert.equal(preparedRemote.status, 200)
    const preparedRemoteBody = await preparedRemote.text()
    assert(preparedRemoteBody.includes('"remote":{"id":"expert-1","source":"bailian"}'))
    assert(!preparedRemoteBody.includes('secret-bailian-key'))
    assert.equal((await request('/api/admin/experts/expert-1/test', 'POST', employeeToken)).status, 401)
    assert.equal((await request('/api/admin/experts/expert-1/test', 'POST', adminToken)).status, 200)
    assert.equal((await request('/api/employee/experts/expert-1/chat', 'POST', employeeToken,
      { prompt: '分析今天销售' })).status, 200)
    assert.equal(bailianAuthorization, 'Bearer secret-bailian-key')
    assert.equal((await request('/api/admin/data/experts/expert-1', 'PUT', adminToken,
      { id: 'expert-1', name: '百炼分析师', description: '分析经营数据', tags: ['分析'], enabled: true,
        source: 'bailian', scope: 'employee', scopeTarget: ['e1'],
        externalConfig: { appId: 'APP12345', apiKey: '' } })).status, 200)
    assert.equal((store.read().experts[0]?.externalConfig as { apiKey: string }).apiKey, 'secret-bailian-key')
    const difyExpert = { id: 'expert-dify', name: 'Dify 顾问', description: '对话助手', tags: ['Dify'], enabled: true,
      source: 'dify', scope: 'employee', scopeTarget: ['e1'],
      externalConfig: { apiUrl: 'https://api.dify.ai/v1', apiKey: 'app-secret', inputs: { department: '营运' } } }
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { ...difyExpert, externalConfig: { ...difyExpert.externalConfig, apiUrl: 'http://api.dify.ai/v1' } })).status, 400)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { ...difyExpert, externalConfig: { ...difyExpert.externalConfig, inputs: [] } })).status, 400)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken, difyExpert)).status, 201)
    const difyPublic = await request('/api/admin/data', 'GET', adminToken).then(response => response.text())
    assert(!difyPublic.includes('app-secret'))
    const difyPrepared = await request('/api/employee/experts/prepare', 'POST', employeeToken,
      { owner: 'enterprise', id: 'expert-dify' })
    assert.equal(difyPrepared.status, 200)
    assert((await difyPrepared.text()).includes('"remote":{"id":"expert-dify","source":"dify"}'))
    assert.equal((await request('/api/admin/experts/expert-dify/test', 'POST', adminToken)).status, 200)
    assert.equal((await request('/api/employee/experts/expert-dify/chat', 'POST', employeeToken,
      { prompt: '分析销售', sessionId: 'previous-session' })).status, 200)
    assert.equal(difyAuthorization, 'Bearer app-secret')
    assert.equal(difyBody.query, '分析销售')
    assert.equal(difyBody.conversation_id, 'previous-session')
    assert.equal(difyBody.user, 'lfclaw-e1')
    assert.deepEqual(difyBody.inputs, { department: '营运' })
    assert.equal(difyBody.response_mode, 'blocking')
    difyMode = 'agent'
    assert.equal((await request('/api/admin/experts/expert-dify/test', 'POST', adminToken)).status, 400)
    difyMode = 'chat'
    assert.equal((await request('/api/admin/data/experts/expert-dify', 'PUT', adminToken,
      { ...difyExpert, externalConfig: { ...difyExpert.externalConfig, apiKey: '' } })).status, 200)
    assert.equal((store.read().experts.find(item => item.id === 'expert-dify')?.externalConfig as { apiKey: string }).apiKey, 'app-secret')
    const weknoraExpert = { id: 'expert-weknora', name: 'WeKnora 顾问', description: '智能体', tags: ['知识'], enabled: true,
      source: 'weknora', scope: 'employee', scopeTarget: ['e1'],
      externalConfig: { apiUrl: 'https://weknora.example.com/api/v1', apiKey: 'sk-weknora', agentId: 'agent-1' } }
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { ...weknoraExpert, externalConfig: { ...weknoraExpert.externalConfig, agentId: '' } })).status, 400)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken,
      { ...weknoraExpert, id: 'expert-weknora-http', externalConfig: { ...weknoraExpert.externalConfig,
        apiUrl: 'http://8.216.38.213:8089/api/v1' } })).status, 201)
    assert.equal((await request('/api/admin/data/experts', 'POST', adminToken, weknoraExpert)).status, 201)
    assert(!(await request('/api/admin/data', 'GET', adminToken).then(response => response.text())).includes('sk-weknora'))
    const weknoraPrepared = await request('/api/employee/experts/prepare', 'POST', employeeToken,
      { owner: 'enterprise', id: 'expert-weknora' })
    assert.equal(weknoraPrepared.status, 200)
    assert((await weknoraPrepared.text()).includes('"remote":{"id":"expert-weknora","source":"weknora"}'))
    assert.equal((await request('/api/admin/experts/expert-weknora/test', 'POST', adminToken)).status, 200)
    const weknoraChat = await request('/api/employee/experts/expert-weknora/chat', 'POST', employeeToken,
      { prompt: '查知识' })
    assert.equal(weknoraChat.status, 200)
    const weknoraResult = await weknoraChat.json() as { text: string; sessionId: string }
    assert.equal(weknoraResult.text, 'WeKnora 回复')
    assert.match(weknoraResult.sessionId, /^wk1\./)
    assert.equal(weknoraKey, 'sk-weknora')
    assert.deepEqual(weknoraBody, { query: '查知识', agent_enabled: true, agent_id: 'agent-1' })
    assert.equal((await request('/api/employee/experts/expert-weknora/chat', 'POST', employeeToken,
      { prompt: '继续查询', sessionId: weknoraResult.sessionId })).status, 200)
    weknoraTimeout = true
    const timedOut = await request('/api/employee/experts/expert-weknora/chat', 'POST', employeeToken,
      { prompt: '复杂分析' })
    assert.equal(timedOut.status, 504)
    assert.equal((await timedOut.json() as { code: string }).code, 'EXPERT_TIMEOUT')
    weknoraTimeout = false
    assert.equal((await request('/api/employee/experts/expert-weknora/chat', 'POST', employeeToken,
      { prompt: '无效续聊', sessionId: 'wk1.invalid.invalid' })).status, 400)
    assert.equal((await request('/api/admin/data/experts/expert-weknora', 'PUT', adminToken,
      { ...weknoraExpert, externalConfig: { ...weknoraExpert.externalConfig, apiKey: '' } })).status, 200)
    assert.equal((store.read().experts.find(item => item.id === 'expert-weknora')?.externalConfig as { apiKey: string }).apiKey, 'sk-weknora')
    assert.equal((await request('/api/admin/permissions/experts/expert-1/e1', 'PUT', adminToken,
      { decision: 'deny' })).status, 200)
    assert.equal((await request('/api/employee/experts/expert-1/chat', 'POST', employeeToken,
      { prompt: '分析今天销售' })).status, 403)
    assert(!(await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as {
      experts: Array<{ id: string }> }).experts.some(item => item.id === 'team-1'))
    const deniedTeam = await request('/api/admin/employees/e1/effective', 'GET', adminToken).then(response => response.json()) as {
      resources: Array<{ collection: string; id: string; allowed: boolean }> }
    assert.equal(deniedTeam.resources.find(item => item.collection === 'experts' && item.id === 'team-1')?.allowed, false)
    assert.equal(new AuthService(join(directory, 'admin-auth.json'), undefined, lifetimes).resolve(employeeToken)?.employeeId, 'e1')
    assert.equal((await request('/api/employee/skills/s1/download', 'GET')).status, 401)
    const firstSkillDownload = await request('/api/employee/skills/s1/download', 'GET', employeeToken)
    assert.equal(firstSkillDownload.status, 200)
    assert.deepEqual(new Uint8Array(await firstSkillDownload.arrayBuffer()), skillArchive)
    const nextArchive = zipSync({ 'report/SKILL.md': strToU8('---\nname: report\ndescription: 新版日报\n---\n# Report 2\n') })
    const nextUploadBody = new FormData()
    nextUploadBody.append('file', new Blob([new Uint8Array(nextArchive)]), 'report-v2.zip')
    const nextUploadResponse = await fetch(root + '/api/admin/skills/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: nextUploadBody,
    })
    assert.equal(nextUploadResponse.status, 201)
    const nextUploadedSkill = await nextUploadResponse.json() as { path: string }
    assert.equal((await request('/api/admin/data/skills/s1', 'PUT', adminToken,
      { id: 's1', name: '新日报', zipPath: nextUploadedSkill.path, version: '999', description: '伪造', enabled: true, scope: 'all' })).status, 200)
    assert.equal(store.read().skills[0]?.version, '2')
    assert.equal(store.read().skills[0]?.description, '新版日报')
    const me = await request('/api/employee/me', 'GET', employeeToken)
    assert.equal(me.status, 200)
    const employeeView = await me.json() as { models: unknown[]; notifications: unknown[]; connectors: { showToolsInClient: boolean }[]; skills: { id: string; version: string; sha256: string; description: string }[] }
    assert.equal(employeeView.models.length, 1)
    assert.equal(employeeView.notifications.length, 0)
    assert.equal(employeeView.skills[0]?.version, '2')
    assert.equal(employeeView.skills[0]?.description, '新版日报')
    const nextSkillDownload = await request('/api/employee/skills/s1/download', 'GET', employeeToken)
    assert.equal(nextSkillDownload.status, 200)
    assert.deepEqual(new Uint8Array(await nextSkillDownload.arrayBuffer()), nextArchive)
    assert.equal(nextSkillDownload.headers.get('etag'), `"${employeeView.skills[0]?.sha256}"`)
    const skillBackup = createBackup(store, directory)
    const skillBackupEntries = unzipSync(new Uint8Array(readFileSync(join(directory, 'backups', `${skillBackup.id}.zip`))))
    assert.deepEqual(skillBackupEntries[`skills/${uploadedSkill.path}`], skillArchive)
    assert.deepEqual(skillBackupEntries[`skills/${nextUploadedSkill.path}`], nextArchive)
    assert.equal((await fetch(root + '/api/employee/skills/s1/download', {
      headers: { Authorization: `Bearer ${employeeToken}`, 'If-None-Match': `"${employeeView.skills[0]?.sha256}"` },
    })).status, 304)
    const versions = await request('/api/admin/skills/s1/versions', 'GET', adminToken)
    assert.equal(versions.status, 200)
    assert.deepEqual((await versions.json() as { versions: { revision: number }[] }).versions.map(item => item.revision), [2, 1])
    assert.equal((await request('/api/admin/skills/s1/rollback', 'POST', employeeToken, { revision: 1 })).status, 401)
    assert.equal((await request('/api/admin/skills/s1/rollback', 'POST', adminToken, { revision: 999 })).status, 409)
    assert.equal((await request('/api/admin/skills/s1/rollback', 'POST', adminToken, { revision: 1 })).status, 200)
    assert.equal(store.read().skills[0]?.version, '3')
    assert.equal(store.read().skills[0]?.description, uploadedSkill.description)
    const restoredSkillDownload = await request('/api/employee/skills/s1/download', 'GET', employeeToken)
    assert.equal(restoredSkillDownload.status, 200)
    assert.deepEqual(new Uint8Array(await restoredSkillDownload.arrayBuffer()), skillArchive)
    assert.deepEqual((await request('/api/admin/skills/s1/versions', 'GET', adminToken).then(response => response.json()) as
      { versions: { revision: number; restoredFromRevision?: number }[] }).versions.map(item => item.revision), [3, 2, 1])
    assert.equal(store.read().operationLogs.some(item => item.type === 'rollback:skills' && item.object === 's1'), true)
    writeFileSync(join(directory, 'skills', nextUploadedSkill.path), 'damaged archive')
    assert.equal((await request('/api/admin/skills/s1/rollback', 'POST', adminToken, { revision: 2 })).status, 409)
    assert.equal(store.read().skills[0]?.version, '3')
    writeFileSync(join(directory, 'skills', nextUploadedSkill.path), nextArchive)
    assert.equal((await request('/api/admin/data/skills/s1', 'PUT', adminToken,
      { id: 's1', name: '新日报', zipPath: nextUploadedSkill.path, enabled: true, scope: 'employee', scopeTarget: ['another'] })).status, 200)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as { skills: unknown[] }).skills.length, 0)
    assert.equal((await request('/api/employee/skills/s1/download', 'GET', employeeToken)).status, 403)
    assert.equal((await request('/api/admin/data/skills/s1', 'PUT', adminToken,
      { id: 's1', name: '新日报', zipPath: nextUploadedSkill.path, enabled: true, scope: 'employee', scopeTarget: ['e1'] })).status, 200)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as { skills: unknown[] }).skills.length, 1)
    const employeeJson = JSON.stringify(employeeView)
    assert(!employeeJson.includes('secret-model-key'))
    assert(!employeeJson.includes('secret-connector-key'))
    assert(employeeJson.includes('denied'))
    assert.equal(employeeView.connectors[0]?.showToolsInClient, true)
    assert.equal((await request('/api/admin/data/connectors/c1', 'PUT', adminToken,
      { ...store.read().connectors[0], showToolsInClient: false })).status, 200)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as {
      connectors: { showToolsInClient: boolean }[]
    }).connectors[0]?.showToolsInClient, false)
    assert.equal((await request('/api/employee/connectors/c1/tools', 'GET', employeeToken)).status, 503)
    assert.equal((await request('/api/admin/data/skills/s1', 'PUT', adminToken,
      { id: 's1', name: '新日报', zipPath: nextUploadedSkill.path, enabled: false, scope: 'all' })).status, 200)
    assert.equal((await request('/api/employee/skills/s1/download', 'GET', employeeToken)).status, 403)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as { skills: unknown[] }).skills.length, 0)
    assert.equal((await request('/api/admin/data', 'GET', employeeToken)).status, 401)
    assert.equal((await request('/api/employee/connectors/c1/tools', 'GET', employeeToken)).status, 503)
    assert.equal((await request('/api/employee/connectors/c1/call', 'POST', employeeToken,
      { name: '禁用', arguments: {} })).status, 503)
    assert.equal((await request('/api/employee/connectors/c1/call', 'POST', employeeToken,
      { name: '可用', arguments: {} })).status, 503)
    assert.equal((await request('/api/employee/chat/completions', 'POST', employeeToken,
      { modelId: 'm1', messages: [{ role: 'user', content: 'hi' }] })).status, 200)
    assert.equal(upstreamModelId, 'provider-model-1')
    assert.equal(upstreamMaxTokens, 8192)
    assert.equal(upstreamThinking, undefined)
    const thinkingModel = { ...store.read().models.find(item => item.id === 'm1'), enableThinking: false }
    assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken, thinkingModel)).status, 200)
    assert.equal((await request('/api/employee/v1/chat/completions', 'POST', employeeToken,
      { model: 'm1', messages: [{ role: 'user', content: 'hi' }] })).status, 200)
    assert.equal(upstreamThinking, false)
    assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken,
      { ...thinkingModel, enableThinking: 'false' })).status, 400)
    assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken,
      { ...thinkingModel, enableThinking: null })).status, 200)
    assert.equal((await request('/api/employee/v1/chat/completions', 'POST', employeeToken,
      { model: 'm1', messages: [{ role: 'user', content: 'hi' }] })).status, 200)
    assert.equal(upstreamThinking, undefined)
    const capacityModel = { ...store.read().models.find(item => item.id === 'm1'), contextWindow: 131072, maxTokens: 32768 }
    for (const invalid of [{ maxTokens: 0 }, { maxTokens: 1.5 }, { contextWindow: 0 }, { maxTokens: 200000 }, { maxTokens: '32768' }]) {
      assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken, { ...capacityModel, ...invalid })).status, 400)
      assert.equal((await request('/api/admin/data/models', 'POST', adminToken, { ...capacityModel, ...invalid, id: 'invalid-capacity' })).status, 400)
    }
    assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken, capacityModel)).status, 200)
    const capacities = await (await request('/api/employee/me', 'GET', employeeToken)).json() as { models: { maxTokens: number; contextWindow: number }[] }
    assert.equal(capacities.models[0]?.maxTokens, 32768)
    assert.equal(capacities.models[0]?.contextWindow, 131072)
    for (const [requested, expected] of [[undefined, 32768], [65536, 32768], [16384, 16384]] as const) {
      assert.equal((await request('/api/employee/v1/chat/completions', 'POST', employeeToken,
        { model: 'm1', max_tokens: requested, messages: [{ role: 'user', content: 'hi' }] })).status, 200)
      assert.equal(upstreamMaxTokens, expected)
    }
    assert.equal((await request('/api/employee/v1/chat/completions', 'POST', employeeToken,
      { model: 'm1', max_tokens: -1, messages: [{ role: 'user', content: 'hi' }] })).status, 400)
    const streamed = await request('/api/employee/v1/chat/completions', 'POST', employeeToken,
      { model: 'm1', messages: [{ role: 'user', content: 'hi' }], stream: true })
    assert.equal(streamed.status, 200)
    assert.match(streamed.headers.get('content-type') ?? '', /text\/event-stream/)
    assert.match(await streamed.text(), /data: \[DONE\]/)
    assert.equal((await request('/api/employee/v1/chat/completions', 'POST', employeeToken,
      { model: 'not-authorized', messages: [{ role: 'user', content: 'hi' }] })).status, 403)

    const usage = store.read().modelUsage[0]
    assert.equal(usage?.employeeId, 'e1')
    assert.equal(usage?.totalTokens, 4)
    assert.equal(usage?.costStatus, 'calculated')
    assert.equal(usage?.cost, 0.000005)
    assert.equal(usage?.currency, 'CNY')
    assert.equal(usage?.inputRate, 1)
    assert.equal((await request('/api/admin/data', 'GET', employeeToken)).status, 401)
    assert.equal((await request('/api/admin/usage', 'GET', employeeToken)).status, 401)
    assert.equal((await request('/api/admin/usage?from=2026-02-30', 'GET', adminToken)).status, 400)
    const usageResponse = await request('/api/admin/usage?employeeId=e1&modelId=m1', 'GET', adminToken)
    assert.equal(usageResponse.status, 200)
    const usageSummary = await usageResponse.json() as { total: { calls: number; totalTokens: number }; employees: { id: string }[]; models: { id: string }[] }
    assert(usageSummary.total.calls > 0)
    assert.equal(usageSummary.total.totalTokens, usageSummary.total.calls * 4)
    assert.deepEqual(usageSummary.employees.map(row => row.id), ['e1'])
    assert.deepEqual(usageSummary.models.map(row => row.id), ['m1'])
    const dashboardResponse = await request('/api/admin/data', 'GET', adminToken)
    assert.equal(dashboardResponse.status, 200)
    const dashboard = await dashboardResponse.json() as ReturnType<typeof dashboardData>
    const expectedDashboard = dashboardData(new JsonStore(join(directory, 'db.json')).read())
    assert.deepEqual(dashboard.dashboardTrend, expectedDashboard.dashboardTrend)
    assert.deepEqual(dashboard.recentActivities, expectedDashboard.recentActivities)
    assert.equal('modelUsage' in dashboard, false)
    assert(dashboard.dashboardTrend.some(point => point.conversations > 0 && point.tokens > 0 && point.activeEmployees === 1))
    assert(dashboard.recentActivities.length > 0)
    assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken,
      { id: 'm1', name: '展示模型', apiKey: '', enabled: true, scope: 'all', scopeTarget: [],
        pricePerMillionInput: null, pricePerMillionOutput: null, currency: 'CNY' })).status, 200)
    assert.equal((await request('/api/employee/chat/completions', 'POST', employeeToken,
      { modelId: 'm1', messages: [{ role: 'user', content: 'again' }] })).status, 200)
    assert.equal(store.read().modelUsage[0]?.costStatus, 'unavailable')
    assert.equal(store.read().modelUsage[0]?.cost, null)

    assert.equal((await request('/api/admin/data/departments', 'POST', adminToken,
      { id: 'd2', name: '一楼', parentId: 'd1' })).status, 201)
    assert.equal((await request('/api/admin/data/employees/e1', 'PUT', adminToken,
      { id: 'e1', name: '员工', departmentId: 'd2', status: 'active', activationCode: employee.activationCode })).status, 200)
    assert.equal((await request('/api/admin/data/departments/d1', 'PUT', adminToken,
      { id: 'd1', name: '营运部', floor: '2F', selfOperated: true })).status, 200)
    assert.equal((await request('/api/admin/data/departments/d2', 'PUT', adminToken,
      { id: 'd2', name: '一楼', parentId: 'd1', floor: '1F' })).status, 200)
    const mcpPath = '/api/admin/employees/e1/mcp-permissions'
    assert.equal((await request(mcpPath, 'GET', employeeToken)).status, 401)
    const inheritedMcp = await request(mcpPath, 'GET', adminToken)
    assert.equal(inheritedMcp.status, 200)
    assert.deepEqual(await inheritedMcp.json(), { employeeId: 'e1', permissions: [] })
    assert.equal((await request(mcpPath, 'PUT', adminToken,
      { permissions: ['operation.floor.99'] })).status, 400)
    assert.equal((await request(mcpPath, 'PUT', adminToken,
      { permissions: ['operation.floor.3', 'operation.floor.3'] })).status, 400)
    assert.equal((await request(mcpPath, 'PUT', adminToken,
      { permissions: ['operation.floor.3', 'operation.self_operated'] })).status, 200)
    assert.deepEqual((await request(mcpPath, 'GET', adminToken).then(response => response.json()) as { permissions: string[] }).permissions,
      ['operation.floor.3', 'operation.self_operated'])
    assert.deepEqual(new JsonStore(join(directory, 'db.json')).read().employees[0]?.mcpPermissions,
      ['operation.floor.3', 'operation.self_operated'])
    assert.equal((await request('/api/admin/data/employees/e1', 'PUT', adminToken,
      { id: 'e1', name: '员工', departmentId: 'd2', status: 'active', mcpPermissions: ['operation.floor.4'] })).status, 200)
    assert.deepEqual(store.read().employees[0]?.mcpPermissions, ['operation.floor.3', 'operation.self_operated'])
    assert.equal((await request(mcpPath, 'PUT', adminToken, { permissions: [] })).status, 200)
    assert.deepEqual((await request(mcpPath, 'GET', adminToken).then(response => response.json()) as { permissions: string[] }).permissions, [])
    assert.equal((await request(mcpPath, 'PUT', adminToken, { permissions: null })).status, 400)
    assert.deepEqual((await request(mcpPath, 'GET', adminToken).then(response => response.json()) as { permissions: string[] }).permissions,
      [])
    assert.equal((await request('/api/admin/data/models', 'POST', adminToken,
      { id: 'm2', name: '部门模型', enabled: true, isDefault: true, scope: 'department', scopeTarget: ['d1'] })).status, 201)
    assert.equal(store.read().models.find(item => item.id === 'm1')?.isDefault, false)
    assert.equal(store.read().models.find(item => item.id === 'm2')?.isDefault, true)
    let effective = await request('/api/admin/employees/e1/effective', 'GET', adminToken)
    assert.equal(effective.status, 200)
    let resources = (await effective.json() as { resources: { id: string; allowed: boolean; source: string }[] }).resources
    assert.deepEqual(resources.find(item => item.id === 'm2'), {
      collection: 'models', id: 'm2', name: '部门模型', allowed: true, source: 'department:d1', override: 'inherit',
    })
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as { models: unknown[] }).models.length, 2)
    assert.equal((await request('/api/admin/permissions/models/m2/e1', 'PUT', employeeToken,
      { decision: 'deny' })).status, 401)
    assert.equal((await request('/api/admin/permissions/models/m2/e1', 'PUT', adminToken,
      { decision: 'invalid' })).status, 400)
    assert.equal((await request('/api/admin/permissions/models/m2/e1', 'PUT', adminToken,
      { decision: 'deny' })).status, 200)
    effective = await request('/api/admin/employees/e1/effective', 'GET', adminToken)
    resources = (await effective.json() as { resources: { id: string; allowed: boolean; source: string }[] }).resources
    assert.equal(resources.find(item => item.id === 'm2')?.source, 'employee-deny')
    assert.equal((await request('/api/employee/me', 'GET', employeeToken).then(response => response.json()) as { models: unknown[] }).models.length, 1)
    assert.equal((await request('/api/admin/permissions/connectors/c1/e1', 'PUT', adminToken,
      { decision: 'deny' })).status, 200)
    assert.equal((await request('/api/employee/connectors/c1/tools', 'GET', employeeToken)).status, 403)
    assert.equal((await request('/api/admin/permissions/connectors/c1/e1', 'PUT', adminToken,
      { decision: 'inherit' })).status, 200)
    assert.equal((await request('/api/employee/connectors/c1/tools', 'GET', employeeToken)).status, 503)
    assert.equal((await request('/api/admin/permissions/models/m2/e1', 'PUT', adminToken,
      { decision: 'inherit' })).status, 200)
    assert.equal((await request('/api/admin/data/models/m2', 'PUT', adminToken,
      { id: 'm2', name: '个人模型', enabled: true, scope: 'employee', scopeTarget: ['other'] })).status, 200)
    assert.equal((await request('/api/admin/permissions/models/m2/e1', 'PUT', adminToken,
      { decision: 'allow' })).status, 200)
    effective = await request('/api/admin/employees/e1/effective', 'GET', adminToken)
    resources = (await effective.json() as { resources: { id: string; allowed: boolean; source: string }[] }).resources
    assert.equal(resources.find(item => item.id === 'm2')?.source, 'employee-allow')

    assert.equal((await request('/api/admin/data/models/m1', 'PUT', adminToken, { id: 'm1', name: 'test', apiKey: '', enabled: false, scope: 'all', scopeTarget: [] })).status, 200)
    assert.equal((await request('/api/employee/chat/completions', 'POST', employeeToken, { modelId: 'm1', messages: [{ role: 'user', content: 'hello' }] })).status, 403)
    assert(readFileSync(join(directory, 'db.json'), 'utf8').includes('secret-model-key'))

    assert.equal((await request('/api/admin/data/employees/e1', 'PUT', adminToken, { id: 'e1', name: '员工', departmentId: 'd1', status: 'inactive', activationCode: employee.activationCode })).status, 200)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken)).status, 401)
    assert.equal((await request('/api/admin/data/employees/e1', 'PUT', adminToken, { id: 'e1', name: '员工', departmentId: 'd1', status: 'active', activationCode: employee.activationCode })).status, 200)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken)).status, 200)

    const reset = await request('/api/admin/employees/e1/reset-code', 'POST', adminToken)
    assert.equal(reset.status, 200)
    assert.equal((await request('/api/employee/me', 'GET', employeeToken)).status, 401)
    assert.equal((await request('/api/employee/activate', 'POST', undefined, { code: employee.activationCode })).status, 401)
    const newCode = (await reset.json() as { activationCode: string }).activationCode
    const newActivation = await request('/api/employee/activate', 'POST', undefined, { code: newCode })
    assert.equal(newActivation.status, 200)
    const liveEmployeeToken = (await newActivation.json() as { token: string }).token
    assert.equal((await request('/api/admin/password', 'POST', adminToken,
      { currentPassword: 'incorrect', nextPassword: 'new-admin-password-123' })).status, 401)
    const changedPassword = await request('/api/admin/password', 'POST', adminToken,
      { currentPassword: 'test-admin-password-123', nextPassword: 'new-admin-password-123' })
    assert.equal(changedPassword.status, 200)
    const changedAdminToken = (await changedPassword.json() as { token: string }).token
    assert.equal((await request('/api/admin/data', 'GET', adminToken)).status, 401)
    assert.equal((await request('/api/admin/data', 'GET', changedAdminToken)).status, 200)
    store.update(db => { db.modelUsage.push({ id: 'bad-usage', createdAt: 'invalid', employeeId: 'e1' }) })
    const invalidDashboard = await request('/api/admin/data', 'GET', changedAdminToken)
    assert.equal(invalidDashboard.status, 503)
    assert.equal((await invalidDashboard.json() as { code: string }).code, 'DATA_INVALID')
    assert(store.read().modelUsage.some(item => item.id === 'bad-usage'))
    store.update(db => { db.modelUsage = db.modelUsage.filter(item => item.id !== 'bad-usage') })
    assert.equal((await request('/api/admin/data', 'GET', changedAdminToken)).status, 200)
    assert.equal((await request('/api/employee/me', 'GET', liveEmployeeToken)).status, 200)
    assert.equal(new AuthService(join(directory, 'admin-auth.json'), undefined, lifetimes).login('admin', 'test-admin-password-123'), null)
    for (let index = 0; index < 3; index++) {
      assert.equal((await request('/api/admin/login', 'POST', undefined,
        { username: 'admin', password: 'wrong' })).status, 401)
    }
    const limitedLogin = await request('/api/admin/login', 'POST', undefined,
      { username: 'admin', password: 'new-admin-password-123' })
    assert.equal(limitedLogin.status, 429)
    assert(Number(limitedLogin.headers.get('retry-after')) > 0)
    for (let index = 0; index < 3; index++) {
      assert.equal((await request('/api/employee/activate', 'POST', undefined,
        { code: 'wrong' })).status, 401)
    }
    assert.equal((await request('/api/employee/activate', 'POST', undefined,
      { code: newCode })).status, 429)
  } finally {
    globalThis.fetch = originalFetch
    server.close()
    await once(server, 'close')
    rmSync(directory, { recursive: true, force: true })
  }
})

test('损坏数据文件时拒绝读写并保留原文件', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-store-test-'))
  try {
    const path = join(directory, 'db.json')
    writeFileSync(path, '{broken', 'utf8')
    const store = new JsonStore(path)
    assert.throws(() => store.read(), { code: 'DATA_INVALID' })
    assert.throws(() => store.update(db => { db.departments.push({ id: 'd1' }) }), { code: 'DATA_INVALID' })
    assert.equal(readFileSync(path, 'utf8'), '{broken')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('手动备份恢复模型用量，拒绝完整性正确但数据结构无效的归档', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-backup-test-'))
  try {
    const store = new JsonStore(join(directory, 'db.json'))
    store.update(db => {
      db.modelUsage.push({ id: 'usage-1', totalTokens: 7 })
      db.personalExperts.push({ id: 'private-1', ownerEmployeeId: 'employee-1', name: '私人专家' })
    })
    const original = createBackup(store, directory)
    const archive = readFileSync(join(directory, 'backups', `${original.id}.zip`))
    assert(!Buffer.from(unzipSync(archive)['database.json']!).toString('utf8').includes('私人专家'))
    const oldDatabase = strToU8(JSON.stringify(store.read()))
    const oldArchive = zipSync({ 'database.json': oldDatabase,
      'manifest.json': strToU8(JSON.stringify({ format: 1, files: {
        'database.json': createHash('sha256').update(oldDatabase).digest('hex'),
      } })) })
    const downloaded = publicBackupArchive(oldArchive)
    assert(!Buffer.from(unzipSync(downloaded)['database.json']!).toString('utf8').includes('私人专家'))
    assert.doesNotThrow(() => publicBackupArchive(downloaded))
    store.update(db => { db.modelUsage = []; db.backups.push({ id: 'missing-archive' }) })
    restoreBackup(archive, store, directory)
    assert.equal(store.read().modelUsage[0]?.totalTokens, 7)
    assert.equal(store.read().personalExperts[0]?.name, '私人专家')
    assert.equal(store.read().backups.length, 1)
    assert(existsSync(join(directory, 'backups', `${store.read().backups[0]?.id}.zip`)))

    const invalidDatabase = strToU8('{"departments":[]}')
    const invalid = zipSync({
      'database.json': invalidDatabase,
      'manifest.json': strToU8(JSON.stringify({ format: 1, files: {
        'database.json': createHash('sha256').update(invalidDatabase).digest('hex'),
      } })),
    })
    const before = readFileSync(store.path, 'utf8')
    const backupsBefore = store.read().backups.length
    assert.throws(() => restoreBackup(invalid, store, directory), { code: 'DATA_INVALID' })
    assert.equal(readFileSync(store.path, 'utf8'), before)
    assert.equal(store.read().backups.length, backupsBefore)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('持久会话保留旧文件并拒绝过期令牌', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-session-test-'))
  try {
    const authPath = join(directory, 'admin-auth.json')
    const sessionsPath = join(directory, 'sessions.json')
    const lifetimes = { adminMs: 60_000, employeeMs: 120_000 }
    const auth = new AuthService(authPath, 'test-admin-password-123', lifetimes)
    const token = auth.issue({ principal: 'employee', employeeId: 'e1', activationCodeHash: 'hash' })
    const saved = JSON.parse(readFileSync(sessionsPath, 'utf8')) as [string, { expiresAt?: number }][]
    delete saved[0]![1].expiresAt
    writeFileSync(sessionsPath, JSON.stringify(saved))
    const migrated = new AuthService(authPath, undefined, lifetimes)
    assert.equal(migrated.resolve(token)?.employeeId, 'e1')
    const withExpiry = JSON.parse(readFileSync(sessionsPath, 'utf8')) as [string, { expiresAt: number }][]
    assert(withExpiry[0]![1].expiresAt > Date.now())
    withExpiry[0]![1].expiresAt = 0
    writeFileSync(sessionsPath, JSON.stringify(withExpiry))
    const expired = new AuthService(authPath, undefined, lifetimes)
    assert.equal(expired.resolve(token), undefined)
    assert.deepEqual(JSON.parse(readFileSync(sessionsPath, 'utf8')), [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
