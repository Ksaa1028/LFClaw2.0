/** Portable complete Session transfer with recipient-owned files and Agent composition. */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { SessionId, SessionSeq, SessionLogOffset, buildForkSeed, type SessionEvent } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-ui-activation'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ShareId, ShareEmployeeId } from './sharing-types.ts'

interface PortableFile {
  key: string
  name: string
  data: string
  image?: ImageAttachmentRef
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function jsonValue(value: unknown): SessionFormatJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value
  if (Array.isArray(value)) return value.map(jsonValue)
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, jsonValue(item)]),
    )
  throw new Error('会话含有无法分享的数据')
}
function mediaType(value: unknown): ImageMediaType {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif') return value
  throw new Error('分享图片格式无效')
}
function attachment(value: Record<string, unknown>): FileAttachmentRef | ImageAttachmentRef {
  if (
    typeof value.attachmentId !== 'string' ||
    typeof value.bytes !== 'number' ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0
  )
    throw new Error('分享附件引用无效')
  const base = {
    attachmentId: AttachmentId(value.attachmentId),
    bytes: value.bytes,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
  }
  if (value.mediaType !== undefined) {
    if (typeof value.width !== 'number' || typeof value.height !== 'number') throw new Error('分享图片尺寸无效')
    return { ...base, mediaType: mediaType(value.mediaType), width: value.width, height: value.height }
  }
  if (typeof value.name !== 'string') throw new Error('分享文件名称缺失')
  return { ...base, name: value.name }
}
function walk(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) for (const item of value) walk(item, visit)
  else if (record(value)) {
    visit(value)
    for (const item of Object.values(value)) walk(item, visit)
  }
}
function replacements(
  value: unknown,
  paths: Map<string, string>,
  refs: Map<string, FileAttachmentRef | ImageAttachmentRef>,
): unknown {
  if (typeof value === 'string') {
    return paths.get(value) ?? value
  }
  if (Array.isArray(value)) return value.map(item => replacements(item, paths, refs))
  if (!record(value)) return value
  if (typeof value.attachmentId === 'string') {
    const ref = refs.get(value.attachmentId)
    if (!ref) throw new Error('分享缺少会话引用的附件，请让发送人重新分享')
    return ref
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacements(item, paths, refs)]))
}
async function json(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  if (!response.ok)
    throw new Error(record(body) && typeof body.message === 'string' ? body.message : '分享操作失败，请刷新后重试')
  return body
}

/** Mount fixed Host operations; upstream tokens never enter the renderer.
 * Imports use the receiver's default Agent preset and model. No sender runtime configuration is installed.
 * @param ctx - Employee Host services.
 * @param directory - Persistent local root for claimed output files.
 */
export function mountSharing(ctx: Context, directory: string): void {
  const pending = new Map<string, Promise<SessionId>>()
  const upstream = (path: string, init: RequestInit) => ctx.enterpriseConnection.request(`employee/session-shares${path}`, init)
  async function send(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    if (typeof body.sessionId !== 'string' || !Array.isArray(body.recipients) || !body.recipients.length)
      return Response.json({ message: '请选择会话和接收人' }, { status: 400 })
    const policy = await json(await upstream('/policy', { signal }))
    if (!record(policy) || typeof policy.maxBytes !== 'number' || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1)
      throw new Error('分享大小配置无效')
    const id = SessionId(body.sessionId)
    using source = await ctx.sessionQuery.observeSession(id, { signal })
    if (!source.events.some(e => e.type === 'user/message'))
      return Response.json({ message: '会话没有可分享的聊天记录' }, { status: 400 })
    const lastStart = source.events.findLast(e => e.type === 'turn/start'),
      lastEnd = source.events.findLast(e => e.type === 'turn/end')
    if (lastStart && (!lastEnd || lastStart.seq > lastEnd.seq))
      return Response.json({ message: '请等待本轮对话结束后分享' }, { status: 409 })
    const files: PortableFile[] = [],
      references = new Map<string, FileAttachmentRef | ImageAttachmentRef>()
    const paths = new Set<string>()
    let bytes = Buffer.byteLength(JSON.stringify(source.events))
    if (bytes > policy.maxBytes) return Response.json({ message: '聊天与文件总量超过分享上限' }, { status: 413 })
    walk(source.events, (item) => {
      if (typeof item.attachmentId === 'string') references.set(item.attachmentId, attachment(item))
      if (item.type === 'deliverables/presented' && record(item.data) && Array.isArray(item.data.files)) {
        for (const file of item.data.files) if (record(file) && typeof file.path === 'string') paths.add(file.path)
      }
    })
    for (const [key, ref] of references) {
      signal.throwIfAborted()
      if (bytes + ref.bytes > policy.maxBytes) return Response.json({ message: '聊天与文件总量超过分享上限' }, { status: 413 })
      let data: Buffer
      if ('mediaType' in ref) data = Buffer.from((await ctx.attachments.readImage(ref, signal)).data)
      else {
        const chunks: Uint8Array[] = []
        for await (const chunk of ctx.attachments.readFileStream(ref, signal)) chunks.push(chunk)
        data = Buffer.concat(chunks)
      }
      bytes += data.length
      files.push({ key, name: ref.name ?? key, data: data.toString('base64'), ...('mediaType' in ref ? { image: ref } : {}) })
    }
    for (const path of paths) {
      const target = await ctx.fs.resolve(path, { ...(source.header.cwd ? { cwd: source.header.cwd } : {}), signal })
      const data = await ctx.fs.readBytes(target, signal, Math.max(1, policy.maxBytes - bytes))
      bytes += data.length
      if (bytes > policy.maxBytes) return Response.json({ message: '聊天与文件总量超过分享上限' }, { status: 413 })
      files.push({ key: `path:${path}`, name: basename(path), data: Buffer.from(data).toString('base64') })
    }
    const header = { ...source.header, delegationDepth: source.header.delegationDepth ?? 0 }
    const payload = {
      version: 1,
      header: sessionFormatCatalog.encodeCurrentHeader(header, source.inheritedEventCount),
      events: source.events.map(event => sessionFormatCatalog.encodeCurrentEvent({ ...event, data: jsonValue(event.data) })),
      files,
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : body.sessionId
    const init = {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, recipients: body.recipients, payload }),
    }
    try {
      return await upstream('', init)
    } catch (cause) {
      throw new Error('无法确认分享发送结果，请接收人核对消息后再操作', { cause })
    }
  }
  async function claim(id: string, signal: AbortSignal): Promise<SessionId> {
    const identity = await json(await ctx.enterpriseConnection.request('employee/me', { signal }))
    if (!record(identity) || !record(identity.employee) || typeof identity.employee.id !== 'string')
      throw new Error('无法读取接收人身份')
    const localId = SessionId(
      `session-share-${createHash('sha256')
        .update(identity.employee.id + ':' + id)
        .digest('hex')}`,
    )
    if (ctx.sessions.get(localId) || (await ctx.sessionPersistence.stat(localId, { signal }))) return localId
    const payload = await json(await upstream(`/${encodeURIComponent(id)}/download`, { signal }))
    if (!record(payload) || payload.version !== 1 || !Array.isArray(payload.events) || !Array.isArray(payload.files))
      throw new Error('分享会话格式无效')
    const notices = await json(await upstream('/notices', { signal }))
    const notice: unknown = Array.isArray(notices) ? notices.find(n => record(n) && n.shareId === id) : undefined
    if (
      !record(notice) ||
      typeof notice.senderName !== 'string' ||
      typeof notice.title !== 'string' ||
      typeof notice.senderId !== 'string' ||
      typeof notice.createdAt !== 'number'
    )
      throw new Error('分享来源信息缺失')
    const refs = new Map<string, FileAttachmentRef | ImageAttachmentRef>(),
      paths = new Map<string, string>()
    const root = resolve(directory, localId)
    await mkdir(root, { recursive: true })
    for (const value of payload.files) {
      if (!record(value) || typeof value.key !== 'string' || typeof value.name !== 'string' || typeof value.data !== 'string')
        throw new Error('分享附件格式无效')
      const data = Buffer.from(value.data, 'base64')
      if (data.toString('base64') !== value.data) throw new Error('分享附件编码无效')
      if (value.key.startsWith('path:')) {
        const path = join(root, `${paths.size}-${basename(value.name).replace(/[^\p{L}\p{N}._-]/gu, '_') || 'file'}`)
        await writeFile(path, data, { mode: 0o600 })
        paths.set(value.key.slice(5), path)
      } else {
        if (createHash('sha256').update(data).digest('hex') !== value.key) throw new Error('分享附件摘要不一致')
        const ref = record(value.image)
          ? await ctx.attachments.saveImage({ data, mediaType: mediaType(value.image.mediaType), name: value.name })
          : await ctx.attachments.saveFile({ data, name: value.name })
        refs.set(value.key, ref)
      }
    }
    if (!record(payload.header)) throw new Error('分享会话头信息无效')
    const restore = sessionFormatCatalog.createRestore(
      { ...payload.header, cwd: root },
      { recovery: 'strict', validation: 'current' },
    )
    for (const event of payload.events) restore.decodeRow(replacements(event, paths, refs))
    const artifact = restore.finish()
    const events = artifact.events as SessionEvent[]
    if (!events.length) throw new Error('分享会话没有聊天记录')
    const seed = buildForkSeed(events, SessionSeq(events.length - 1))
    const presets = ctx.get('agentPresets'),
      preset = presets ? await presets.resolve(undefined) : undefined
    const handle = await ctx.agents.create({
      sessionId: localId,
      seed,
      inheritedEventCount: SessionLogOffset(events.length),
      signal,
      meta: { cwd: root, isSeeded: true, parentSession: SessionId(artifact.header.id), ...(preset ? { agentPreset: preset.id } : {}) },
      agentOptions: ctx.agentDefaultModel.currentSelection(),
      setup: async (agentCtx) => {
        if (presets && preset) await presets.mount(agentCtx, preset.id)
      },
    })
    try {
      handle.agent.session.append('lfclaw/share-received', {
        shareId: brandString<ShareId>(id),
        senderId: brandString<ShareEmployeeId>(notice.senderId),
        senderName: notice.senderName,
        sharedAt: notice.createdAt,
        title: notice.title,
      })
      if (preset) handle.agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      ctx.sessionTitle.rename(handle.agent.session, `【${notice.senderName}分享】${notice.title}`)
      handle.agent.session.append('model/selection', ctx.agentDefaultModel.currentSelection())
      await ctx.sessions.flush(handle.agent.session)
      ctx.effect(() => () => handle.dispose(), `lfclaw: claimed ${localId}`)
    } catch (error) {
      await handle.dispose()
      throw error
    }
    return localId
  }
  for (const operation of ['employees', 'policy', 'notices', 'announcements', 'send', 'claim'])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `/api/lfclaw/sharing-${operation}`,
          methods:
            operation === 'send' || operation === 'claim'
              ? ['POST']
              : operation === 'notices' || operation === 'announcements'
                ? ['GET', 'POST']
                : ['GET'],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              const url = new URL(request.url),
                signal = request.signal
              if (operation === 'send' || operation === 'claim') {
                const body: unknown = await request.json()
                if (!record(body)) return Response.json({ message: '请求格式无效' }, { status: 400 })
                if (operation === 'send') return await send(body, signal)
                if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id))
                  return Response.json({ message: '分享编号无效' }, { status: 400 })
                const key = body.id
                let operationPromise = pending.get(key)
                if (!operationPromise) {
                  operationPromise = claim(key, signal)
                  pending.set(key, operationPromise)
                }
                try {
                  return Response.json({ sessionId: await operationPromise })
                } finally {
                  if (pending.get(key) === operationPromise) pending.delete(key)
                }
              }
              const response = await (operation === 'announcements'
                ? ctx.enterpriseConnection.request('employee/announcements', {
                  method: request.method,
                  signal,
                  ...(request.method === 'POST'
                    ? { body: await request.text(), headers: { 'Content-Type': 'application/json' } }
                    : {}),
                })
                : upstream(
                  `/${operation}${operation === 'employees' ? `?q=${encodeURIComponent(url.searchParams.get('q') ?? '')}` : ''}`,
                  {
                    method: request.method,
                    signal,
                    ...(request.method === 'POST'
                      ? { body: await request.text(), headers: { 'Content-Type': 'application/json' } }
                      : {}),
                  },
                ))
              return new Response(response.body, {
                status: response.status,
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
              })
            } catch (error) {
              ctx.logger.warn('会话分享失败：%s', String(error))
              return Response.json(
                { code: 'SHARING_FAILED', message: error instanceof Error ? error.message : '会话分享失败，请刷新列表核对结果' },
                { status: 503 },
              )
            }
          },
        }),
      `lfclaw: sharing ${operation}`,
    )
}
