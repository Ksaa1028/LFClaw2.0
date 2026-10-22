/** Test-only MCP server for local-command connector discovery and execution. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'personal-fixture', version: '1' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'local_lookup',
  description: 'Read fixture environment', inputSchema: { type: 'object', properties: {} } }] }))
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: process.env.PERSONAL_FIXTURE_VALUE ?? 'missing' }] }))
await server.connect(new StdioServerTransport())
