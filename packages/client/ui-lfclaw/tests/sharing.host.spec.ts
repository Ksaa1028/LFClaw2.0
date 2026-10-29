import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SESSION_FORMAT_VERSION, SessionLogOffset, type CreateSessionOptions } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { mountSharing } from '../src/sharing.ts'
import '../src/sharing-types.ts'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'

it('transfers upload and AI output bytes, creates an inherited local copy, and uses receiver composition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'share-host-'))
  const source = Session.create(SessionId('source'))
  const data = Buffer.from('原始上传文件'),
    output = Buffer.from('AI输出文件')
  const attachmentId = AttachmentId(createHash('sha256').update(data).digest('hex'))
  const ref = { attachmentId, name: 'input.txt', bytes: data.length }
  source.append(
    'user/message',
    createUserMessage({
      source: { kind: 'user' },
      content: [
        { type: 'text', text: '请分析附件；路径 /sender/output.txt 只是文字' },
        { type: 'file', attachment: ref },
      ],
    }),
    { surfaceOp: 'append' },
  )
  source.append('deliverables/presented', { turn: 1, callId: ToolCallId('call-output'), files: [{ path: '/sender/output.txt' }] })
  source.append('session-log-deepseek/delivery-accepted', {
    sessionId: source.id, sessionFormatVersion: SESSION_FORMAT_VERSION, throughSeq: source.snapshotEvents().at(-1)!.seq,
  })
  const original = JSON.stringify(source.snapshotEvents())
  let payload: unknown, received: Session | undefined
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  const saveFile = vi.fn(async () => ref),
    dispose = vi.fn(async () => {})
  const mount = vi.fn(async () => {}),
    selectModel = vi.fn(async () => {})
  const create = vi.fn(
    async (options: CreateSessionOptions & { sessionId: SessionId; setup: (ctx: Context) => Promise<void> }) => {
      await options.setup(ctx)
      received = Session.create(
        options.sessionId,
        options.seed,
        { version: SESSION_FORMAT_VERSION, id: options.sessionId, createdAt: 1, isSeeded: true, ...options.meta },
        options.inheritedEventCount,
      )
      return { agent: { id: options.sessionId, session: received }, dispose }
    },
  )
  const ctx = new Context()
  ctx.provide('agentPresets', { resolve: vi.fn(async () => ({ id: 'receiver-preset' })), mount })
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === 'employee/me') return Response.json({ employee: { id: 'receiver' } })
    if (path === 'employee/announcements')
      return Response.json([{ id: 'a1', title: '维护', content: '今晚升级', sentAt: '2026-10-19T08:00:00.000Z', read: false }])
    if (path.endsWith('/policy')) return Response.json({ maxBytes: 50 * 1024 * 1024 })
    if (path.endsWith('/notices'))
      return Response.json([
        { shareId: '00000000-0000-4000-8000-000000000001', senderId: 'sender', senderName: '甲', createdAt: 1, title: '分析聊天' },
      ])
    if (path.endsWith('/download')) return Response.json(payload)
    if (typeof init?.body !== 'string') throw new Error('Expected serialized share payload')
    payload = JSON.parse(init.body)
    payload = (payload as { payload: unknown }).payload
    return Response.json({ id: '00000000-0000-4000-8000-000000000001' }, { status: 201 })
  })
  Object.defineProperties(ctx, {
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route.fetch)
            return () => {
              routes.delete(route.path)
            }
          },
        },
      },
    },
    enterpriseConnection: { value: { request: transport } },
    sessionQuery: {
      value: {
        observeSession: async () => ({
          header: source.header,
          events: source.snapshotEvents(),
          inheritedEventCount: SessionLogOffset(0),
          [Symbol.dispose]() {},
        }),
      },
    },
    attachments: {
      value: {
        readFileStream: async function* () {
          yield data
        },
        saveFile,
      },
    },
    fs: { value: { resolve: vi.fn(async (path: string) => ({ path })), readBytes: vi.fn(async () => output) } },
    sessions: { value: { get: () => received, flush: vi.fn(async () => true) } },
    sessionPersistence: { value: { stat: vi.fn(async () => undefined) } },
    agents: { value: { create } },
    agentDefaultModel: { value: { currentSelection: () => ({ provider: 'lfclaw', model: 'receiver-model' }) } },
    sessionController: { value: { selectModel } },
    sessionTitle: { value: { rename: vi.fn() } },
  })
  try {
    mountSharing(ctx, root)
    const announcementResponse = await routes.get('/api/lfclaw/sharing-announcements')!(
      new Request('http://local/api/lfclaw/sharing-announcements'),
    )
    expect(((await announcementResponse.json()) as Array<{ title: string }>)[0]?.title).toBe('维护')
    expect(transport).toHaveBeenCalledWith('employee/announcements', expect.objectContaining({ method: 'GET' }))
    const send = await routes.get('/api/lfclaw/sharing-send')!(
      new Request('http://local/api/lfclaw/sharing-send', {
        method: 'POST',
        body: JSON.stringify({ sessionId: 'source', title: '分析聊天', recipients: ['receiver'] }),
      }),
    )
    expect(send.status).toBe(201)
    const body = JSON.stringify(payload)
    expect(body).toContain(data.toString('base64'))
    expect(body).toContain(output.toString('base64'))
    const request = () =>
      new Request('http://local/api/lfclaw/sharing-claim', {
        method: 'POST',
        body: JSON.stringify({ id: '00000000-0000-4000-8000-000000000001' }),
      })
    const response = await routes.get('/api/lfclaw/sharing-claim')!(request())
    expect(await response.clone().json()).not.toHaveProperty('message')
    expect(response.status).toBe(200)
    const result = (await response.json()) as { sessionId: string }
    expect(result.sessionId).not.toBe(source.id)
    expect(saveFile).toHaveBeenCalledWith({ data, name: 'input.txt' })
    expect(await readFile(join(root, result.sessionId, '0-output.txt'))).toEqual(output)
    expect(received?.header.agentPreset).toBe('receiver-preset')
    expect(received?.header.parentSession).toBe(source.id)
    expect(received?.inheritedEventCount).toBe(source.snapshotEvents().length)
    expect(JSON.stringify(received?.snapshotEvents())).toContain(
      join(root, result.sessionId, '0-output.txt').replaceAll('\\', '\\\\'),
    )
    expect(JSON.stringify(received?.snapshotEvents()[0])).toContain('路径 /sender/output.txt 只是文字')
    expect(received?.snapshotEvents().at(-1)).toMatchObject({
      type: 'model/selection',
      data: { provider: 'lfclaw', model: 'receiver-model' },
    })
    const receipt = received?.snapshotEvents().find(event => event.type === 'lfclaw/share-received')
    expect(receipt?.data).toEqual({
      shareId: '00000000-0000-4000-8000-000000000001',
      senderId: 'sender',
      senderName: '甲',
      sharedAt: 1,
      title: '分析聊天',
    })
    expect(
      receipt &&
        sessionFormatCatalog.encodeCurrentEvent({ type: receipt.type, seq: receipt.seq, time: 1, data: { ...receipt.data } }),
    ).toMatchSnapshot()
    if (!received) throw new Error('Received session was not created')
    const restore = sessionFormatCatalog.createRestore(
      sessionFormatCatalog.encodeCurrentHeader({ ...received.header, delegationDepth: 0 }, received.inheritedEventCount),
      { recovery: 'strict', validation: 'current' },
    )
    for (const event of received.snapshotEvents()) restore.decodeRow(JSON.parse(JSON.stringify(event)))
    expect(restore.finish().events.find(event => event.type === 'lfclaw/share-received')?.data).toEqual(receipt?.data)
    expect(JSON.stringify(source.snapshotEvents())).toBe(original)
    expect((await routes.get('/api/lfclaw/sharing-claim')!(request())).status).toBe(200)
    expect(create).toHaveBeenCalledTimes(1)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
  expect(dispose).toHaveBeenCalledOnce()
})

it('rejects incomplete, oversized and active source sessions before sending any share', async () => {
  const ctx = new Context(),
    source = Session.create(SessionId('source-failure'))
  const routes = new Map<string, (request: Request) => Promise<Response>>()
  let limit = 1024 * 1024
  const request = vi.fn(async (path: string) =>
    path.endsWith('/policy') ? Response.json({ maxBytes: limit }) : Response.json({}),
  )
  Object.defineProperties(ctx, {
    connection: {
      value: {
        fetch: {
          register: (route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
            routes.set(route.path, route.fetch)
            return () => {
              routes.delete(route.path)
            }
          },
        },
      },
    },
    enterpriseConnection: { value: { request } },
    sessionQuery: {
      value: {
        observeSession: async () => ({
          header: source.header,
          events: source.snapshotEvents(),
          inheritedEventCount: SessionLogOffset(0),
          [Symbol.dispose]() {},
        }),
      },
    },
    fs: {
      value: {
        resolve: async () => {
          throw new Error('输出文件已丢失，请恢复文件后再分享')
        },
      },
    },
  })
  const send = () =>
    routes.get('/api/lfclaw/sharing-send')!(
      new Request('http://local/api/lfclaw/sharing-send', {
        method: 'POST',
        body: JSON.stringify({ sessionId: source.id, title: '失败验收', recipients: ['receiver'] }),
      }),
    )
  try {
    mountSharing(ctx, 'unused')
    expect((await send()).status).toBe(400)
    source.append(
      'user/message',
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '需要完整附件' }] }),
      { surfaceOp: 'append' },
    )
    source.append('deliverables/presented', {
      turn: 1,
      callId: ToolCallId('missing-file'),
      files: [{ path: '/missing/output.txt' }],
    })
    const missing = await send()
    expect(missing.status).toBe(503)
    expect(await missing.json()).toMatchObject({ message: '输出文件已丢失，请恢复文件后再分享' })
    source.append('turn/start', { turn: 1 })
    expect((await send()).status).toBe(409)
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    limit = 1
    const oversize = await send()
    expect(oversize.status).toBe(413)
    expect(request.mock.calls.every(([path]) => path.endsWith('/policy'))).toBe(true)
  } finally {
    await ctx.fiber.dispose()
  }
})
