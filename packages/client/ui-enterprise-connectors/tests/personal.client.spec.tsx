// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConnectorsPage } from '../src/client/ConnectorsPage.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('separates enterprise and personal connectors and retains a form when saving fails', async () => {
  const requests: object[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/lfclaw/connector-center') return Response.json({ connectors: [], refreshIntervalMs: 30000 })
      if (init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return Response.json({ code: 'protected' }, { status: 403 })
      }
      return Response.json({ connectors: [] })
    }),
  )
  render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.personal }))
  await screen.findByText(zh.emptyPersonal)
  fireEvent.click(screen.getByRole('button', { name: zh.createConnector }))
  fireEvent.change(screen.getByLabelText(zh.connectorName), { target: { value: '个人数据' } })
  fireEvent.change(screen.getByLabelText(zh.endpoint), { target: { value: 'https://example.com/mcp' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.protectedConnector)
  expect(screen.getByLabelText<HTMLInputElement>(zh.connectorName).value).toBe('个人数据')
  expect(requests).toMatchObject([
    { operation: 'save', item: { name: '个人数据', url: 'https://example.com/mcp', headers: {}, enabled: true } },
  ])
})
it('offers creation and editing of saved configurations without an import action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/lfclaw/connector-center') return Response.json({ connectors: [], refreshIntervalMs: 30000 })
      return Response.json({
        connectors: [
          {
            id: 'p1',
            revision: 'v1',
            name: '微软文档测试',
            enabled: true,
            connected: true,
            transport: 'streamable-http',
            command: '',
            args: [],
            env: {},
            headers: {},
            url: 'https://learn.microsoft.com/api/mcp',
            tools: [],
          },
        ],
      })
    }),
  )
  const { container } = render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.personal }))
  const saved = await screen.findByText('微软文档测试')
  expect(screen.queryByRole('button', { name: '导入配置' })).toBeNull()
  expect(screen.getByRole('button', { name: zh.createConnector })).toBeDefined()
  expect(container.textContent).toMatchSnapshot()
  fireEvent.click(saved)
  fireEvent.click(screen.getByRole('button', { name: zh.edit }))
  expect(screen.getByLabelText<HTMLInputElement>(zh.connectorName).value).toBe('微软文档测试')
  expect(screen.getByLabelText<HTMLInputElement>(zh.endpoint).value).toBe('https://learn.microsoft.com/api/mcp')
})
