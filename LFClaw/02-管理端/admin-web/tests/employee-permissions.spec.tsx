import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx'
import { AppContext, initialState } from '../src/store.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('切换员工后，上一员工迟到的权限保存结果不能覆盖当前表单', async () => {
  const saved = Promise.withResolvers<Response>()
  const transport = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return saved.promise
    if (url.endsWith('/mcp-permissions')) return Promise.resolve(Response.json({
      employeeId: url.includes('/e1/') ? 'e1' : 'e2',
      permissions: [url.includes('/e1/') ? 'operation.floor.1' : 'operation.floor.2'],
    }))
    return Promise.resolve(Response.json({ resources: [] }))
  })
  vi.stubGlobal('fetch', transport)
  const showToast = vi.fn()
  render(<AppContext.Provider value={{ state: { ...initialState,
    employees: ['e1', 'e2'].map(id => ({ id, name: id, email: '', departmentId: 'd1', status: 'active', activationCode: id })),
    connectors: [{ id: 'mall', name: '商场', type: 'mcp', endpoint: '', enabled: true, scope: 'all', tools: [], mallDataPermissions: true }],
  }, dispatch: async () => true }}><EmployeesPage t={key => key} showToast={showToast} /></AppContext.Provider>)
  fireEvent.click(screen.getAllByRole('button', { name: 'employees.viewDetail' })[0]!)
  fireEvent.click(await screen.findByRole('button', { name: 'employees.mallMcpSave' }))
  await waitFor(() => expect(transport.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'close' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'employees.viewDetail' })[1]!)
  const secondFloor = await screen.findByRole('checkbox', { name: 'employees.mallMcpFloor2' }) as HTMLInputElement
  expect(secondFloor.checked).toBe(true)
  await act(async () => { saved.resolve(Response.json({ employeeId: 'e1', permissions: ['operation.floor.1'] })); await saved.promise })
  expect(secondFloor.checked).toBe(true)
  expect((screen.getByRole('checkbox', { name: 'employees.mallMcpFloor1' }) as HTMLInputElement).checked).toBe(false)
  expect(showToast).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'employees.mallMcpSave' }))
  await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.stringContaining('/e2/mcp-permissions'),
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ permissions: ['operation.floor.2'] }) })))
})


it('员工权限直接多选并允许清空，不展示部门继承模式', async () => {
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { permissions: string[] }
      writes.push(body)
      return Response.json({ employeeId: 'e1', permissions: body.permissions })
    }
    return Response.json(url.endsWith('/mcp-permissions') ? { employeeId: 'e1', permissions: [] } : { resources: [] })
  }))
  render(<AppContext.Provider value={{ state: { ...initialState,
    employees: [{ id: 'e1', name: '员工', email: '', departmentId: 'd1', status: 'active', activationCode: 'fixture' }],
    connectors: [{ id: 'mall', name: '商场', type: 'mcp', endpoint: '', enabled: true, scope: 'all', tools: [], mallDataPermissions: true }],
  }, dispatch: async () => true }}><EmployeesPage t={key => key} showToast={vi.fn()} /></AppContext.Provider>)
  fireEvent.click(screen.getByRole('button', { name: 'employees.viewDetail' }))
  const first = await screen.findByRole('checkbox', { name: 'employees.mallMcpFloor1' })
  const second = screen.getByRole('checkbox', { name: 'employees.mallMcpFloor2' })
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.getAllByRole('checkbox').map(node => node.closest('label')?.textContent)).toMatchSnapshot()
  fireEvent.click(first); fireEvent.click(second)
  fireEvent.click(screen.getByRole('button', { name: 'employees.mallMcpSave' }))
  await waitFor(() => expect(writes).toEqual([{ permissions: ['operation.floor.1', 'operation.floor.2'] }]))
  await waitFor(() => expect(screen.getByRole('button', { name: 'employees.mallMcpSave' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(first); fireEvent.click(second)
  fireEvent.click(screen.getByRole('button', { name: 'employees.mallMcpSave' }))
  await waitFor(() => expect(writes).toEqual([{ permissions: ['operation.floor.1', 'operation.floor.2'] }, { permissions: [] }]))
})
