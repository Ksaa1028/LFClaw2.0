/**
 * Forward only the expert center's fixed employee operations using Host credentials.
 * @param request - Authenticated local request; no caller headers are forwarded.
 * @param upstream - Host-owned enterprise transport.
 * @param catalogMaxAgeMs - Maximum display snapshot age; explicit refresh and preparation always request fresh state.
 * @returns Upstream status or an explicit unknown-outcome failure after connection loss.
 */
export async function expertRequest(
  request: Request,
  upstream: (path: string, init: RequestInit & { catalogMaxAgeMs?: number }) => Promise<Response>,
  catalogMaxAgeMs = 0,
): Promise<Response> {
  const url = new URL(request.url)
  const operation = url.pathname.split('/').at(-1)
  const id = url.searchParams.get('id')
  const action = url.searchParams.get('action')
  let method = request.method
  let path: string
  if (operation === 'expert-center' && request.method === 'GET')
    path = url.searchParams.get('view') === 'picker' ? 'employee/expert-picker' : 'employee/me'
  else if (operation === 'expert-prepare' && request.method === 'POST') path = 'employee/experts/prepare'
  else if (operation === 'personal-experts' && request.method === 'POST' && id && action === 'delete') {
    path = `employee/personal-experts/${encodeURIComponent(id)}`
    method = 'DELETE'
  } else return Response.json({ message: 'Invalid expert operation' }, { status: 400 })
  try {
    const response = await upstream(path, {
      method,
      signal: request.signal,
      ...(operation === 'expert-center'
        ? { catalogMaxAgeMs: url.searchParams.get('refresh') === '1' || url.searchParams.get('view') === 'picker' ? 0 : catalogMaxAgeMs }
        : {}),
      ...(['POST', 'PUT'].includes(method) ? { headers: { 'Content-Type': 'application/json' }, body: await request.text() } : {}),
    })
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (_error) {
    // Upstream mutations may have committed before the connection failed.
    return Response.json(
      { code: 'EXPERT_CONNECTION_FAILED', message: '无法确认操作结果，请刷新专家列表核对后再操作' },
      { status: 503 },
    )
  }
}
