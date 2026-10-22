/** Bounded model declarations with on-demand discovery for large MCP catalogs. */
import type { Context } from '@deepseek-ai/cordis'
import { createMcpToolDefinition, type McpToolDefinitionOptions } from '@deepseek-ai/dsh-mcp-client'
import { validateJsonSchemaValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'

/** Deployment limits for inline declarations and discovery responses. */
export interface ToolCatalogConfig {
  /** Maximum schema characters included directly in model tool declarations. */
  inlineToolSchemaChars: number
  /** Maximum number of tools returned by one catalog page. */
  toolCatalogPageSize: number
  /** Maximum characters returned for one full tool definition. */
  toolDefinitionPageChars: number
  /** Maximum characters included in each catalog tool summary. */
  toolSummaryChars: number
}

/** Resolve limits before registering a connector.
 * @param config - Optional deployment overrides.
 * @returns Complete limits shared by enterprise and personal connectors.
 */
export function resolveToolCatalogConfig(config: Partial<ToolCatalogConfig>): ToolCatalogConfig {
  return {
    inlineToolSchemaChars: config.inlineToolSchemaChars ?? 16000,
    toolCatalogPageSize: config.toolCatalogPageSize ?? 10,
    toolDefinitionPageChars: config.toolDefinitionPageChars ?? 12000,
    toolSummaryChars: config.toolSummaryChars ?? 320,
  }
}

/** Keep small catalogs native; expose large catalogs through one bounded discovery/call tool.
 * @param ctx - Host services used by MCP result projection.
 * @param name - Stable registry name for the connector catalog.
 * @param label - Connector name displayed to the model.
 * @param tools - Currently authorized tools with their original invocation callbacks.
 * @param config - Resolved response and declaration limits.
 * @param check - Reject discovery after authorization or configuration changes.
 * @returns Definitions for the current registration generation.
 */
export function connectorToolDefinitions(
  ctx: Context,
  name: string,
  label: string,
  tools: McpToolDefinitionOptions[],
  config: ToolCatalogConfig,
  check: () => void | Promise<void>,
): ToolDefinition[] {
  const size = tools.reduce(
    (sum, tool) =>
      sum +
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }).length,
    0,
  )
  if (size <= config.inlineToolSchemaChars) return tools.map(tool => createMcpToolDefinition(ctx, tool))
  const definitions = new Map(tools.map(tool => [tool.rawName, createMcpToolDefinition(ctx, tool)]))
  const validators = new Map(tools.map(tool => [tool.rawName, new AjvJsonSchemaValidator().getValidator(tool.inputSchema)]))
  const parameters = {
    type: 'object',
    additionalProperties: false,
    properties: {
      operation: { type: 'string', enum: ['list', 'describe', 'call'] },
      query: { type: 'string', description: 'list: optional search in tool names and descriptions.' },
      tool: { type: 'string', description: 'describe/call: exact upstream name returned by list.' },
      offset: { type: 'integer', minimum: 0, description: 'Pagination offset returned by a preceding list/describe.' },
      path: {
        type: 'string',
        description: 'describe: optional JSON Pointer within the tool definition, e.g. /inputSchema/properties/filter.',
      },
      arguments: {
        type: 'object',
        additionalProperties: true,
        description: 'call: arguments matching the discovered original inputSchema.',
      },
    },
    required: ['operation'],
  }
  const selected = new WeakMap<object, ToolDefinition>()
  const validate = new AjvJsonSchemaValidator().getValidator<{
    operation: 'list' | 'describe' | 'call'
    query?: string
    tool?: string
    offset?: number
    path?: string
    arguments?: Record<string, unknown>
  }>(parameters)
  const summary = createMcpToolDefinition(ctx, {
    name,
    rawName: label,
    description: `${label} 的 MCP 工具入口。先 list 搜索可用工具，再 describe 读取所选工具参数，最后 call 执行。无需在文件或命令行寻找此连接器。较长定义分页返回，也可用 path 读取所需字段。`,
    inputSchema: parameters,
    call: async () => {
      throw new Error('Catalog invocation must use the definition dispatcher')
    },
  })
  return [
    {
      ...summary,
      async execute(raw, execution) {
        await check()
        const checked = validate(raw)
        if (!checked.valid) throw new Error(`连接器入口参数无效：${checked.errorMessage}`)
        const args = checked.data
        const offset = args.offset ?? 0
        let result: unknown
        if (args.operation === 'list') {
          const query = (args.query ?? '').toLocaleLowerCase()
          const matches = tools.filter(tool => `${tool.rawName} ${tool.description}`.toLocaleLowerCase().includes(query))
          const page = matches.slice(offset, offset + config.toolCatalogPageSize)
          result = {
            tools: page.map(tool => ({
              name: tool.rawName,
              description: tool.description.slice(0, config.toolSummaryChars),
              descriptionTruncated: tool.description.length > config.toolSummaryChars,
            })),
            total: matches.length,
            ...(offset + page.length < matches.length ? { nextOffset: offset + page.length } : {}),
          }
        } else {
          const tool = tools.find(tool => tool.rawName === args.tool)
          const definition = args.tool ? definitions.get(args.tool) : undefined
          if (!tool || !definition) throw new Error('工具不存在或当前无权限，请重新 list 查询。')
          if (args.operation === 'call') {
            const input = args.arguments ?? {}
            const validation = validators.get(tool.rawName)!(input)
            if (!validation.valid)
              throw new Error(`工具参数不符合定义：${validation.errorMessage.slice(0, config.toolDefinitionPageChars)}`)
            selected.set(execution, definition)
            const value = await definition.execute(input, execution)
            await check()
            const outputErrors = validateJsonSchemaValue(definition.output.schema, value, 'result')
            if (outputErrors.length) throw new Error('MCP 返回内容不符合工具输出定义。')
            return value
          }
          let value: unknown = { name: tool.rawName, description: tool.description, inputSchema: tool.inputSchema }
          if (args.path) {
            if (!args.path.startsWith('/')) throw new Error('path 必须是 JSON Pointer，以 / 开头。')
            for (const part of args.path
              .slice(1)
              .split('/')
              .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
              if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new Error('定义路径不存在。')
              value = (value as Record<string, unknown>)[part]
            }
          }
          const text = JSON.stringify(value)
          result = {
            tool: tool.rawName,
            path: args.path ?? '',
            definitionJson: text.slice(offset, offset + config.toolDefinitionPageChars),
            totalChars: text.length,
            ...(offset + config.toolDefinitionPageChars < text.length
              ? { nextOffset: offset + config.toolDefinitionPageChars }
              : {}),
          }
        }
        await check()
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      },
      projectContent(execution, result) {
        return selected.get(execution)?.projectContent?.(execution, result)
      },
    },
  ]
}
