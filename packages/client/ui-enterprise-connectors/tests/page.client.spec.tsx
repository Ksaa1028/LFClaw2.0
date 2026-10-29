// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConnectorsPage } from '../src/client/ConnectorsPage.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const catalog = {
  connectors: [
    {
      id: 'c1',
      name: '商场数据',
      type: 'mcp',
      icon: 'data:image/png;base64,iVBORw0KGgo=',
      showToolsInClient: true,
      tools: [{ id: 't1', name: 'search_sales', description: '查询销售数据' }],
    },
  ],
  refreshIntervalMs: 30000,
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows connector summaries before deferred icons resolve', async () => {
  const images = Promise.withResolvers<Response>()
  const transport = vi.fn().mockResolvedValueOnce(Response.json({ ...catalog, summary: true,
    connectors: catalog.connectors.map(item => ({ ...item, icon: '' })),
  })).mockImplementation(() => images.promise)
  vi.stubGlobal('fetch', transport)
  const view = render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  try {
    await screen.findByRole('button', { name: /商场数据/u })
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2))
    expect(transport.mock.calls[0]?.[0]).toContain('summary=1')
    expect(transport.mock.calls[1]?.[0]).not.toContain('revision=')
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.baseElement).toMatchSnapshot()
    images.resolve(Response.json(catalog))
    await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull())
  } finally { view.unmount(); images.resolve(Response.json(catalog)) }
})

it.each([true, false])(
  'blocks starting a connector without authorized tools when tool visibility is %s',
  async (showToolsInClient) => {
    const startChat = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            ...catalog,
            connectors: [{ ...catalog.connectors[0], showToolsInClient, hasAvailableTools: false, tools: [] }],
          }),
        ),
    )
    const view = render(<ConnectorsPage t={t} startChat={startChat} />)
    fireEvent.click(await screen.findByRole('button', { name: /商场数据/u }))
    expect(screen.getByRole('status').textContent).toBe(zh.noTools)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.useConnector }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.check }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: zh.useConnector }))
    expect(startChat).not.toHaveBeenCalled()
    expect(view.baseElement).toMatchSnapshot()
  },
)

it('renders an older Host catalog without exposing its unmarked tools', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        connectors: [
          { id: 'c1', name: '商场数据', type: 'mcp', tools: [{ id: 't1', name: 'search_sales', description: '查询销售数据' }] },
        ],
        refreshIntervalMs: 30000,
      }),
    ),
  )
  render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /商场数据/u }))
  expect(screen.getByText(zh.toolsHidden)).toBeDefined()
  expect(screen.queryByText('search_sales')).toBeNull()
})

it('shows a connector without disclosing its hidden tools', async () => {
  const startChat = vi.fn()
  const transport = vi.fn().mockResolvedValueOnce(
    Response.json({
      connectors: [
        {
          id: 'c1',
          name: '商场数据',
          type: 'mcp',
          icon: 'data:image/png;base64,iVBORw0KGgo=',
          showToolsInClient: false,
          hasAvailableTools: true,
          tools: [],
        },
      ],
      refreshIntervalMs: 30000,
    }),
  )
  vi.stubGlobal('fetch', transport)
  render(<ConnectorsPage t={t} startChat={startChat} />)
  const card = await screen.findByRole('button', { name: /商场数据/u })
  expect(card.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
  fireEvent.click(card)
  expect(screen.getByText(zh.toolsHidden)).toBeDefined()
  expect(screen.queryByText('search_sales')).toBeNull()
  expect(screen.queryByText(zh.toolCount.replace('{count}', '0'))).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.useConnector }))
  expect(startChat).toHaveBeenCalledWith('商场数据')
})

it('shows authorized tools and reports a live connector failure without dropping the catalog', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockResolvedValueOnce(Response.json({ code: 'CONNECTOR_UNAVAILABLE' }, { status: 503 }))
  vi.stubGlobal('fetch', transport)
  render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /商场数据/u }))
  expect(screen.getByText('search_sales')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh.check }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.disconnected)
  expect(screen.getByText('search_sales')).toBeDefined()
  expect(transport.mock.calls[1]?.[0]).toBe('/api/lfclaw/connector-center?id=c1')
})

it('clears stale permissions when refresh fails and shows an in-place retry notice', async () => {
  const transport = vi.fn().mockResolvedValueOnce(Response.json(catalog)).mockRejectedValueOnce(new Error('offline'))
  vi.stubGlobal('fetch', transport)
  render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('商场数据')
  fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe(zh.unavailable)
  })
  expect(screen.queryByText('商场数据')).toBeNull()
})

it('removes previously visible connectors when the employee session loses authorization', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockResolvedValueOnce(Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }))
  vi.stubGlobal('fetch', transport)
  render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('商场数据')
  fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe(zh.unavailable)
  })
  expect(screen.queryByText('商场数据')).toBeNull()
})

it('updates the displayed floor scope on a server notification and ignores an older connection check', async () => {
  const changed = Promise.withResolvers<Response>()
  const check = Promise.withResolvers<Response>()
  const revision = 'a'.repeat(64)
  const nextRevision = 'b'.repeat(64)
  const transport = vi.fn((path: string, init?: RequestInit) => {
    if (path.includes('?id=')) return check.promise
    if (path.includes(`revision=${revision}`)) return changed.promise
    if (path.includes(`revision=${nextRevision}`))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(init.signal?.reason)
          },
          { once: true },
        )
      })
    return Promise.resolve(
      Response.json({ ...catalog, revision, connectors: [{ ...catalog.connectors[0], dataPermissions: ['operation.floor.1'] }] }),
    )
  })
  vi.stubGlobal('fetch', transport)
  render(<ConnectorsPage t={t} startChat={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /商场数据/u }))
  fireEvent.click(screen.getByRole('button', { name: zh.check }))
  await waitFor(() => {
    expect(transport.mock.calls.some(([path]) => path.includes('revision='))).toBe(true)
  })
  changed.resolve(
    Response.json({
      ...catalog,
      revision: nextRevision,
      connectors: [{ ...catalog.connectors[0], dataPermissions: ['operation.floor.2'] }],
    }),
  )
  await waitFor(() => {
    expect(screen.getAllByText('数据范围：二层').length).toBeGreaterThan(0)
  })
  expect(screen.queryByText('数据范围：一层')).toBeNull()
  check.resolve(Response.json({ tools: [] }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: zh.check })).toBeDefined()
  })
  expect(screen.queryByText(zh.connected)).toBeNull()
  expect(screen.getByRole('dialog').textContent).toMatchSnapshot()
})
