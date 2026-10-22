import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConnectorsPage } from '../src/pages/ConnectorsPage.tsx'
import { AppContext, initialState } from '../src/store.ts'
import type { Connector } from '../src/mock/data.ts'

afterEach(cleanup)

function setup(connector?: Connector) {
  const dispatch = vi.fn(async () => true)
  const showToast = vi.fn()
  render(<AppContext.Provider value={{ state: { ...initialState, connectors: connector ? [connector] : [] }, dispatch }}>
    <ConnectorsPage t={key => key} showToast={showToast} />
  </AppContext.Provider>)
  fireEvent.click(screen.getByRole('button', { name: connector ? 'edit' : 'connectors.addConnector' }))
  return { dispatch, showToast }
}

it('stdio 表单提交 command、args、env，远程地址和 Header 不再展示', async () => {
  const { dispatch, showToast } = setup()
  fireEvent.change(screen.getByLabelText('connectors.transport'), { target: { value: 'stdio' } })
  expect(screen.queryByLabelText('connectors.endpoint')).toBeNull()
  expect(screen.queryByText('connectors.headers')).toBeNull()
  expect(screen.getByRole('dialog').textContent).toMatchSnapshot()
  fireEvent.change(screen.getByLabelText('connectors.connectorName'), { target: { value: '公众号' } })
  fireEvent.change(screen.getByLabelText('connectors.command'), { target: { value: 'npx' } })
  fireEvent.change(screen.getByLabelText('connectors.args'), { target: { value: '["-y", "fixture-package"]' } })
  fireEvent.change(screen.getByLabelText('connectors.env', { exact: false }), { target: { value: '{"APP_ID":"fixture"}' } })
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_CONNECTOR', payload: expect.objectContaining({
    transport: 'stdio', command: 'npx', args: ['-y', 'fixture-package'], env: { APP_ID: 'fixture' }, endpoint: '', headers: {},
  }) }))
  expect(showToast).toHaveBeenCalledWith('save', 'success')
})

it('非法 JSON 保留表单并提示，已有配置可读回编辑', () => {
  const { dispatch, showToast } = setup({ id: 'local', name: '本地', type: 'mcp', transport: 'stdio',
    command: 'npx', args: ['-y', 'fixture'], env: { TOKEN: '' }, enabled: true, scope: 'all', tools: [] })
  expect((screen.getByLabelText('connectors.command') as HTMLInputElement).value).toBe('npx')
  expect((screen.getByLabelText('connectors.args') as HTMLTextAreaElement).value).toContain('fixture')
  fireEvent.change(screen.getByLabelText('connectors.args'), { target: { value: '{"wrong":true}' } })
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  expect(dispatch).not.toHaveBeenCalled()
  expect(showToast).toHaveBeenCalledWith('connectors.stdioInvalid')
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('员工账号模式只提交公共环境变量', async () => {
  const { dispatch } = setup()
  fireEvent.change(screen.getByLabelText('connectors.connectorName'), { target: { value: '公众号' } })
  fireEvent.change(screen.getByLabelText('connectors.transport'), { target: { value: 'stdio' } })
  fireEvent.change(screen.getByLabelText('connectors.authType'), { target: { value: 'token' } })
  fireEvent.change(screen.getByLabelText('connectors.accountMode'), { target: { value: 'employee' } })
  fireEvent.change(screen.getByLabelText('connectors.command'), { target: { value: 'npx' } })
  fireEvent.change(screen.getByLabelText('connectors.env'), { target: { value: JSON.stringify({
    API_KEY: 'old-secret', DATA_DIR: 'C:/fixture-data',
  }) } })
  fireEvent.click(screen.getByRole('button', { name: 'save' }))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_CONNECTOR', payload: expect.objectContaining({
    authentication: expect.objectContaining({ type: 'token', owner: 'employee' }), env: { DATA_DIR: 'C:/fixture-data' },
  }) }))
})
