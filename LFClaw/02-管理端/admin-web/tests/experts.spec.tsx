import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExpertsPage } from '../src/pages/ExpertsPage.tsx'
import { AppContext, initialState } from '../src/store.ts'
import type { Expert } from '../src/mock/data.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveExpertImport } from '../../server/src/expert-import.ts'
import { JsonStore } from '../../server/src/store.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const expert: Expert = {
  id: 'e1', name: '经营专家', description: '分析经营数据', enabled: true, tags: [],
  source: 'dsh', scope: 'all', scopeTarget: [],
}
const team: Expert = { ...expert, id: 't1', name: '经营专家团', source: 'team', memberIds: ['e1', 'e2'] }

function renderExperts(showToast = vi.fn(), dispatch = vi.fn().mockResolvedValue(true)) {
  render(<AppContext.Provider value={{ state: { ...initialState, experts: [expert, team] }, dispatch }}>
    <ExpertsPage t={key => key} showToast={showToast} />
  </AppContext.Provider>)
}

it('配置 Dify 对话专家时保存 API 地址、密钥及输入变量', async () => {
  const dispatch = vi.fn().mockResolvedValue(true)
  const showToast = vi.fn()
  renderExperts(showToast, dispatch)
  fireEvent.click(screen.getByRole('button', { name: 'experts.addExternal' }))
  fireEvent.change(screen.getByLabelText('experts.source'), { target: { value: 'dify' } })
  fireEvent.change(screen.getByLabelText('experts.expertName'), { target: { value: 'Dify 顾问' } })
  fireEvent.change(screen.getByLabelText('experts.difyApiUrl'), { target: { value: 'https://api.dify.ai/v1' } })
  fireEvent.change(screen.getByLabelText('experts.difyApiKey'), { target: { value: 'app-secret' } })
  fireEvent.change(screen.getByLabelText('experts.difyInputs'), { target: { value: '[]' } })
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  expect(showToast).toHaveBeenCalledWith('experts.difyInputsInvalid')
  expect(dispatch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('experts.difyInputs'), { target: { value: '{"department":"营运"}' } })
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_EXPERT',
    payload: expect.objectContaining({ source: 'dify', externalConfig: {
      apiUrl: 'https://api.dify.ai/v1', apiKey: 'app-secret', inputs: { department: '营运' } },
    }) })))
})

it('配置 WeKnora Agent 时提交 API 地址、Agent ID 和空间密钥', async () => {
  const dispatch = vi.fn().mockResolvedValue(true)
  renderExperts(vi.fn(), dispatch)
  fireEvent.click(screen.getByRole('button', { name: 'experts.addExternal' }))
  fireEvent.change(screen.getByLabelText('experts.source'), { target: { value: 'weknora' } })
  fireEvent.change(screen.getByLabelText('experts.expertName'), { target: { value: '知识顾问' } })
  fireEvent.change(screen.getByLabelText('experts.weknoraApiUrl'), { target: { value: 'https://weknora.example.com/api/v1' } })
  fireEvent.change(screen.getByLabelText('experts.weknoraAgentId'), { target: { value: 'agent-1' } })
  fireEvent.change(screen.getByLabelText('experts.weknoraApiKey'), { target: { value: 'sk-secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_EXPERT',
    payload: expect.objectContaining({ source: 'weknora', externalConfig: expect.objectContaining({
      apiUrl: 'https://weknora.example.com/api/v1', agentId: 'agent-1', apiKey: 'sk-secret',
    }) }) })))
})

it('远程 WeKnora HTTP 地址可直接保存', async () => {
  const dispatch = vi.fn().mockResolvedValue(true)
  renderExperts(vi.fn(), dispatch)
  fireEvent.click(screen.getByRole('button', { name: 'experts.addExternal' }))
  fireEvent.change(screen.getByLabelText('experts.source'), { target: { value: 'weknora' } })
  fireEvent.change(screen.getByLabelText('experts.expertName'), { target: { value: '知识顾问' } })
  fireEvent.change(screen.getByLabelText('experts.weknoraApiUrl'), { target: { value: 'http://8.216.38.213:8089/api/v1' } })
  fireEvent.change(screen.getByLabelText('experts.weknoraAgentId'), { target: { value: 'agent-1' } })
  fireEvent.change(screen.getByLabelText('experts.weknoraApiKey'), { target: { value: 'sk-secret' } })
  expect(screen.queryByRole('switch', { name: 'experts.weknoraAllowHttp' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_EXPERT',
    payload: expect.objectContaining({ source: 'weknora', externalConfig: expect.objectContaining({
      apiUrl: 'http://8.216.38.213:8089/api/v1',
    }) }) })))
})

it('管理端专家中心只展示单专家与单专家导入入口', () => {
  renderExperts()
  expect(screen.getByText('经营专家')).toBeTruthy()
  expect(screen.queryByText('经营专家团')).toBeNull()
  expect(screen.queryByRole('button', { name: 'experts.teams' })).toBeNull()
  expect(screen.getByRole('button', { name: 'experts.importOriginal' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'experts.importOriginal' }))
  expect(screen.queryByText('experts.importTeam')).toBeNull()
})

it('单专家导入入口拒绝专家团预览', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json({ expert: team, members: [] }))
  vi.stubGlobal('fetch', transport)
  const showToast = vi.fn()
  renderExperts(showToast)
  fireEvent.click(screen.getByRole('button', { name: 'experts.importOriginal' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'experts.importParameters' }), { target: { value: '{"kind":"team"}' } })
  fireEvent.click(screen.getByRole('button', { name: 'experts.validateImport' }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('experts.teamImportUnavailable'))
  expect(screen.getByRole('button', { name: 'save' }).hasAttribute('disabled')).toBe(true)
  expect(transport).toHaveBeenCalledTimes(1)
})

it('参数示例能通过实际导入规则的预览校验', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lfclaw-admin-expert-example-'))
  try {
    const store = new JsonStore(join(directory, 'db.json'))
    const transport = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json(resolveExpertImport(body.definition, store.read(), body))
    })
    vi.stubGlobal('fetch', transport)
    renderExperts()
    fireEvent.click(screen.getByRole('button', { name: 'experts.importOriginal' }))
    fireEvent.click(screen.getByRole('button', { name: 'experts.importExample' }))
    fireEvent.click(screen.getByRole('button', { name: 'experts.validateImport' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'save' }).hasAttribute('disabled')).toBe(false))
    expect(transport).toHaveBeenCalledTimes(1)
    expect(store.read().experts).toHaveLength(0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('代理 502 时说明服务不可用而不误报参数错误', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })))
  const showToast = vi.fn()
  renderExperts(showToast)
  fireEvent.click(screen.getByRole('button', { name: 'experts.importOriginal' }))
  fireEvent.click(screen.getByRole('button', { name: 'experts.importExample' }))
  fireEvent.click(screen.getByRole('button', { name: 'experts.validateImport' }))
  await waitFor(() => expect(showToast).toHaveBeenCalledWith('experts.importServiceUnavailable'))
  expect(screen.getByRole('button', { name: 'save' }).hasAttribute('disabled')).toBe(true)
})
