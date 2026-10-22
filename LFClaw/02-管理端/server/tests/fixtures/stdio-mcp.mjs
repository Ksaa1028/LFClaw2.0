/** Standalone JSON-RPC fixture for enterprise stdio transport tests. */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'

const [auditFile, sampleArg] = process.argv.slice(2)
const audit = event => appendFileSync(auditFile, JSON.stringify({ event, pid: process.pid, appId: process.env.WECHAT_APP_ID }) + '\n')
audit('start')
if (process.env.WECHAT_APP_SECRET === 'reject-fixture') process.exit(1)
const input = createInterface({ input: process.stdin })
input.on('close', () => process.exit(0))
input.on('line', line => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  let result
  if (message.method === 'initialize') {
    result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'stdio-fixture', version: '1' } }
  } else if (message.method === 'tools/list') {
    result = { tools: ['echo', 'hold'].map(name => ({ name, description: name, inputSchema: { type: 'object' } })) }
  } else if (message.method === 'tools/call') {
    audit(message.params.name)
    if (message.params.name === 'hold') return
    result = { content: [{ type: 'text', text: JSON.stringify({
      argument: sampleArg, credential: process.env.FIXTURE_TOKEN,
      inheritedCredential: process.env.LFCLAW_TEST_PARENT_SECRET ?? null,
      ...(process.env.WECHAT_APP_ID ? { appId: process.env.WECHAT_APP_ID,
        secretDigest: createHash('sha256').update(process.env.WECHAT_APP_SECRET).digest('hex'),
        dataDirectory: process.env.DATA_DIR } : {}),
    }) }] }
  } else {
    result = {}
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
})
