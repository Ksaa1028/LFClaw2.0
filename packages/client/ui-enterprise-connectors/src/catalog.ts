/** Validated authorized connector metadata. No endpoint or credential enters this response. */
export interface ConnectorSummary {
  id: string
  name: string
  type: string
  icon: string
  showToolsInClient: boolean
  dataPermissions?: string[]
  account?:
    | { kind: 'wechat-mp'; configured: boolean }
    | {
      kind: 'credentials'
      configured: boolean
      configuration: string
      revision: string
      type: 'token' | 'fields' | 'oauth'
      owner: 'enterprise' | 'employee'
      status: 'connected' | 'disconnected' | 'reauthorize'
      fields: { key: string; label: string; required: boolean; secret: boolean }[]
    }
  tools: { id: string; name: string; description: string }[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Decode only a binding status, never employee credentials.
 * @param value - Untrusted account summary.
 * @returns Validated status or no employee binding requirement.
 */
export function parseConnectorAccount(value: unknown): ConnectorSummary['account'] {
  if (value === undefined) return undefined
  const item = record(value)
  if (typeof item?.configured !== 'boolean') throw new Error('invalid connector account')
  if (item.kind === 'wechat-mp') return { kind: 'wechat-mp', configured: item.configured }
  if (
    item.kind !== 'credentials' ||
    (item.type !== 'token' && item.type !== 'fields' && item.type !== 'oauth') ||
    typeof item.configuration !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.configuration) ||
    typeof item.revision !== 'string' ||
    item.revision.length > 4096 ||
    (item.owner !== 'enterprise' && item.owner !== 'employee') ||
    (item.status !== 'connected' && item.status !== 'disconnected' && item.status !== 'reauthorize') ||
    !Array.isArray(item.fields) ||
    item.fields.length > 20
  )
    throw new Error('invalid connector account')
  const fields = item.fields.map((value: unknown) => {
    const field = record(value)
    if (
      !field ||
      typeof field.key !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.key) ||
      typeof field.label !== 'string' ||
      field.label.length > 100 ||
      typeof field.required !== 'boolean' ||
      typeof field.secret !== 'boolean'
    )
      throw new Error('invalid credential field')
    return { key: field.key, label: field.label, required: field.required, secret: field.secret }
  })
  return {
    kind: 'credentials',
    configured: item.configured,
    configuration: item.configuration,
    revision: item.revision,
    type: item.type,
    owner: item.owner,
    status: item.status,
    fields,
  }
}

/**
 * Decode the employee catalog before exposing its connector subset to the renderer.
 * @param value - untrusted enterprise API JSON.
 * @returns the authorized connector summaries only.
 */
export function parseConnectors(value: unknown): ConnectorSummary[] {
  const root = record(value)
  if (!Array.isArray(root?.connectors)) throw new Error('invalid connector catalog')
  return root.connectors.map((raw: unknown) => {
    const item = record(raw)
    if (
      typeof item?.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.type !== 'string' ||
      !Array.isArray(item.tools)
    )
      throw new Error('invalid connector catalog')
    const tools = item.tools.map((rawTool: unknown) => {
      const tool = record(rawTool)
      if (typeof tool?.id !== 'string' || typeof tool.name !== 'string') throw new Error('invalid connector tool')
      return { id: tool.id, name: tool.name, description: typeof tool.description === 'string' ? tool.description : '' }
    })
    if (item.showToolsInClient !== undefined && typeof item.showToolsInClient !== 'boolean')
      throw new Error('invalid connector visibility')
    if (
      item.dataPermissions !== undefined &&
      (!Array.isArray(item.dataPermissions) ||
        item.dataPermissions.some(
          permission => typeof permission !== 'string' || !/^operation\.(?:floor\.[1-4]|self_operated)$/.test(permission),
        ))
    )
      throw new Error('invalid data permissions')
    if (
      item.icon !== undefined &&
      (typeof item.icon !== 'string' ||
        (item.icon !== '' && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.icon)))
    )
      throw new Error('invalid connector icon')
    const account = parseConnectorAccount(item.account)
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      icon: item.icon ?? '',
      showToolsInClient: item.showToolsInClient !== false,
      tools,
      ...(account ? { account } : {}),
      ...(item.dataPermissions !== undefined ? { dataPermissions: item.dataPermissions as string[] } : {}),
    }
  })
}

/** Validate the authorization revision used for long polling.
 * @param value - enterprise catalog JSON.
 * @returns opaque revision digest.
 */
export function catalogRevision(value: unknown): string {
  const root = record(value)
  if (typeof root?.revision !== 'string' || !/^[a-f0-9]{64}$/.test(root.revision))
    throw new Error('invalid authorization revision')
  return root.revision
}
