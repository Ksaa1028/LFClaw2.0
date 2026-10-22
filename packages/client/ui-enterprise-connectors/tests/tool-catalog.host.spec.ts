import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { connectorToolDefinitions, resolveToolCatalogConfig } from '../src/tool-catalog.ts'

it('bounds large declarations, pages exact schemas and rejects invalid calls before invoking MCP', async () => {
  const call = vi.fn(async () => ({ content: [{ type: 'text', text: '42' }] }))
  const inputSchema = {
    type: 'object',
    properties: { a: { type: 'integer', description: 'x'.repeat(80000) } },
    required: ['a'],
    additionalProperties: false,
  }
  const tool = { name: 'search_test', rawName: 'search', description: 'search tool', inputSchema, call }
  const [catalog] = connectorToolDefinitions(
    new Context(),
    'catalog',
    'Notion test',
    [tool],
    resolveToolCatalogConfig({}),
    () => {},
  )
  expect(JSON.stringify(catalog!.parameters).length).toBeLessThan(2000)
  const execution = { signal: AbortSignal.timeout(5000) } as never
  const listed = await catalog!.execute({ operation: 'list', query: 'search' }, execution)
  expect(JSON.stringify(listed)).toContain('"name":"search"'.replaceAll('"', '\\"'))
  const expected = JSON.stringify({ name: tool.rawName, description: tool.description, inputSchema })
  let reconstructed = ''
  for (let offset = 0; offset < expected.length; offset += 12000) {
    const page = (await catalog!.execute({ operation: 'describe', tool: 'search', offset }, execution)) as {
      content: Array<{ text: string }>
    }
    const data = JSON.parse(page.content[0]!.text)
    expect(data.definitionJson.length).toBeLessThanOrEqual(12000)
    reconstructed += data.definitionJson
  }
  expect(reconstructed).toBe(expected)
  await expect(catalog!.execute({ operation: 'call', tool: 'search', arguments: { a: '17' } }, execution)).rejects.toThrow(
    '参数不符合',
  )
  expect(call).not.toHaveBeenCalled()
  expect(await catalog!.execute({ operation: 'call', tool: 'search', arguments: { a: 17 } }, execution)).toEqual({
    content: [{ type: 'text', text: '42' }],
  })
  expect(call).toHaveBeenCalledTimes(1)
})

it('checks current authorization before discovery and after an in-flight MCP result', async () => {
  let allowed = true
  const pending = Promise.withResolvers<unknown>()
  const called = Promise.withResolvers<void>()
  const call = vi.fn(async () => {
    called.resolve()
    return pending.promise
  })
  const [catalog] = connectorToolDefinitions(
    new Context(),
    'catalog',
    'test',
    [{ name: 'read', rawName: 'read', description: 'x'.repeat(17000), inputSchema: { type: 'object' }, call }],
    resolveToolCatalogConfig({}),
    () => {
      if (!allowed) throw new Error('permission revoked')
    },
  )
  const execution = { signal: AbortSignal.timeout(5000) } as never
  const result = catalog!.execute({ operation: 'call', tool: 'read' }, execution)
  await called.promise
  allowed = false
  pending.resolve({ content: [{ type: 'text', text: 'must not escape' }] })
  await expect(result).rejects.toThrow('permission revoked')
  await expect(catalog!.execute({ operation: 'list' }, execution)).rejects.toThrow('permission revoked')
})
