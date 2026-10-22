/** Employee-addressed temporary disk shares; chat payloads never enter the enterprise database. */
import express, { type Request } from 'express'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerOptions } from './app.ts'
import { activationHash, bearerToken, requireAdmin } from './auth.ts'

interface Policy { retentionDays: number; maxBytes: number }
interface Share {
  id: string; senderId: string; senderName: string; title: string; createdAt: number; expiresAt: number
  recipients: string[]; bytes: number; digest: string
}
interface Notice { id: string; shareId: string; employeeId: string; createdAt: number; read: boolean; deleted: boolean }
interface State { version: 1; policy: Policy; shares: Share[]; notices: Notice[] }
const day = 86400000
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validPolicy = (value: unknown): value is Policy => record(value) && Number.isSafeInteger(value.retentionDays)
  && Number(value.retentionDays) >= 1 && Number(value.retentionDays) <= 365 && Number.isSafeInteger(value.maxBytes)
  && Number(value.maxBytes) >= 1024 && Number(value.maxBytes) <= 1024 * 1024 * 1024

/** Disk owner serializes metadata publication and enforces expiry before every download.
 * Failed publication may leave an unreachable blob, removed by the next cleanup.
 */
export class SessionShares {
  private readonly statePath: string
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    this.statePath = join(directory, 'index.json')
    this.read()
  }
  private read(): State {
    if (!existsSync(this.statePath)) return { version: 1, policy: { retentionDays: 30, maxBytes: 50 * 1024 * 1024 }, shares: [], notices: [] }
    const state: unknown = JSON.parse(readFileSync(this.statePath, 'utf8'))
    if (!record(state) || state.version !== 1 || !validPolicy(state.policy) || !Array.isArray(state.shares) || !Array.isArray(state.notices)
      || state.shares.some((s: unknown) => !record(s) || typeof s.id !== 'string' || !uuid.test(s.id)
        || typeof s.senderId !== 'string' || typeof s.senderName !== 'string' || typeof s.title !== 'string'
        || !Number.isFinite(s.createdAt) || !Number.isFinite(s.expiresAt) || !Number.isSafeInteger(s.bytes)
        || typeof s.digest !== 'string' || !/^[a-f0-9]{64}$/.test(s.digest)
        || !Array.isArray(s.recipients) || s.recipients.some((id: unknown) => typeof id !== 'string'))
      || state.notices.some((n: unknown) => !record(n) || typeof n.id !== 'string' || !uuid.test(n.id)
        || typeof n.shareId !== 'string' || typeof n.employeeId !== 'string' || !Number.isFinite(n.createdAt)
        || typeof n.read !== 'boolean' || typeof n.deleted !== 'boolean')) throw new Error('分享索引损坏，已停止分享操作，请修复数据文件')
    return { version: 1, policy: state.policy, shares: state.shares as Share[], notices: state.notices as Notice[] }
  }
  private save(state: State): void {
    const temporary = join(this.directory, `${randomUUID()}.tmp`)
    writeFileSync(temporary, JSON.stringify(state) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temporary, this.statePath)
  }
  /** Read current administrator limits. @returns Persisted policy or initial defaults. */
  policy(): Policy { return this.read().policy }
  /** Persist validated deployment policy. @param policy - Limits for subsequent uploads. */
  configure(policy: Policy): void { const state = this.read(); state.policy = policy; this.save(state) }
  /** Remove expired payloads independently from the fixed 30-day notice lifetime. @param now - Epoch milliseconds. */
  cleanup(now = Date.now()): void {
    const state = this.read()
    const active = new Set(state.shares.filter(s => s.expiresAt > now).map(s => `${s.id}.json`))
    for (const name of readdirSync(this.directory)) if (name.endsWith('.json') && uuid.test(name.slice(0, -5)) && !active.has(name)) unlinkSync(join(this.directory, name))
    const notices = state.notices.filter(n => n.createdAt + 30 * day > now)
    const referenced = new Set(notices.map(n => n.shareId))
    const shares = state.shares.filter(s => s.expiresAt > now || referenced.has(s.id))
    if (notices.length !== state.notices.length || shares.length !== state.shares.length) this.save({ ...state, notices, shares })
  }
  /** Publish one immutable payload and recipient notices atomically through the index.
   * @param sender - Authenticated employee identity.
   * @param title - Display title.
   * @param recipients - Validated employee IDs.
   * @param payload - Complete portable session JSON.
   * @returns Share metadata.
   */
  create(sender: { id: string; name: string }, title: string, recipients: string[], payload: Buffer, bytes = payload.length): Share {
    const state = this.read(), now = Date.now(), id = randomUUID()
    if (bytes > state.policy.maxBytes) throw new RangeError('分享大小超过上限')
    const share: Share = { id, senderId: sender.id, senderName: sender.name, title, recipients, createdAt: now,
      expiresAt: now + state.policy.retentionDays * day, bytes: payload.length, digest: createHash('sha256').update(payload).digest('hex') }
    writeFileSync(join(this.directory, `${id}.json`), payload, { mode: 0o600, flag: 'wx' })
    state.shares.push(share)
    state.notices.push(...recipients.map(employeeId => ({ id: randomUUID(), shareId: id, employeeId, createdAt: now, read: false, deleted: false })))
    this.save(state)
    return share
  }
  /** List only this employee's notices. @param employeeId - Authenticated recipient. @returns Newest first, including expired status. */
  list(employeeId: string) {
    this.cleanup()
    const state = this.read(), now = Date.now()
    return state.notices.filter(n => n.employeeId === employeeId && !n.deleted).map(n => {
      const share = state.shares.find(s => s.id === n.shareId)
      if (!share) throw new Error('分享通知引用的数据不存在')
      return { ...n, title: share.title, senderName: share.senderName, senderId: share.senderId, expiresAt: share.expiresAt,
        expired: share.expiresAt <= now, bytes: share.bytes }
    }).reverse()
  }
  /** Update synchronized notice state without deleting payloads. @param employeeId - Recipient. @param id - Notice or all. @param action - Mutation. */
  notice(employeeId: string, id: string, action: 'read' | 'unread' | 'delete' | 'clear'): void {
    const state = this.read()
    for (const n of state.notices) if (n.employeeId === employeeId && (id === n.id || action === 'clear')) {
      if (action === 'delete' || action === 'clear') n.deleted = true
      else n.read = action === 'read'
    }
    this.save(state)
  }
  /** Download only while unexpired and explicitly addressed to the recipient.
   * @param employeeId - Authenticated recipient.
   * @param id - Opaque share ID.
   * @returns Payload, null for inaccessible, or expired discriminator.
   */
  download(employeeId: string, id: string): Buffer | null | 'expired' {
    this.cleanup()
    const share = this.read().shares.find(s => s.id === id && s.recipients.includes(employeeId))
    if (!share) return null
    if (share.expiresAt <= Date.now()) return 'expired'
    const payload = readFileSync(join(this.directory, `${share.id}.json`))
    if (payload.length !== share.bytes || createHash('sha256').update(payload).digest('hex') !== share.digest) throw new Error('分享文件校验失败，请联系管理员')
    return payload
  }
}

/** Mount employee-only sharing routes before the general JSON parser.
 * @param app - Enterprise Express application.
 * @param options - Authentication and data ownership.
 * @returns Disk storage for lifecycle-owned periodic cleanup.
 */
export function mountSessionSharing(app: express.Express, options: ServerOptions): SessionShares {
  const shares = new SessionShares(join(options.dataDirectory, 'session-shares'))
  const employee = (req: Request) => {
    const session = options.auth.resolve(bearerToken(req))
    if (session?.principal !== 'employee') return undefined
    return options.store.read().employees.find(e => e.id === session.employeeId && e.status === 'active'
      && activationHash(String(e.activationCode)) === session.activationCodeHash)
  }
  const router = express.Router()
  router.use((req, res, next) => {
    const identity = employee(req)
    if (!identity) { res.status(401).json({ code: 'UNAUTHORIZED', message: '请重新激活后使用会话分享' }); return }
    res.locals.employee = identity; res.setHeader('Cache-Control', 'no-store'); next()
  })
  router.get('/employees', (req, res) => {
    const db = options.store.read(), query = String(req.query.q ?? '').trim().toLocaleLowerCase()
    res.json(db.employees.filter(e => e.status === 'active' && e.id !== res.locals.employee.id)
      .map(e => ({ id: e.id, name: String(e.name), department: String(db.departments.find(d => d.id === e.departmentId)?.name ?? '') }))
      .filter(e => `${e.name} ${e.department}`.toLocaleLowerCase().includes(query)))
  })
  router.get('/policy', (_req, res) => res.json(shares.policy()))
  router.get('/notices', (_req, res) => res.json(shares.list(res.locals.employee.id)))
  router.post('/notices', express.json({ limit: '8kb' }), (req, res) => {
    const body: unknown = req.body
    if (!record(body) || typeof body.id !== 'string' || !['read', 'unread', 'delete', 'clear'].includes(String(body.action))) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '消息操作无效' }); return
    }
    shares.notice(res.locals.employee.id, body.id, body.action as 'read' | 'unread' | 'delete' | 'clear'); res.json({ ok: true })
  })
  router.get('/:id/download', (req, res) => {
    const payload = shares.download(res.locals.employee.id, req.params.id)
    if (payload === null) { res.status(404).json({ code: 'SHARE_NOT_FOUND', message: '无权领取此分享' }); return }
    if (payload === 'expired') { res.status(410).json({ code: 'SHARE_EXPIRED', message: '分享已过期，不能再次领取' }); return }
    res.type('application/json').send(payload)
  })
  router.post('/', (req, res, next) => express.json({ limit: Math.ceil(shares.policy().maxBytes * 1.4) + 65536 })(req, res, next), (req, res) => {
    const body: unknown = req.body, db = options.store.read()
    if (!record(body) || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200
      || !Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > 1000
      || body.recipients.some((id: unknown) => typeof id !== 'string' || id === res.locals.employee.id || !db.employees.some(e => e.id === id && e.status === 'active'))
      || new Set(body.recipients).size !== body.recipients.length || !record(body.payload) || body.payload.version !== 1
      || !record(body.payload.header) || body.payload.header.type !== 'session'
      || !Number.isSafeInteger(body.payload.header.version) || Number(body.payload.header.version) < 0
      || typeof body.payload.header.id !== 'string' || !body.payload.header.id
      || !Array.isArray(body.payload.events) || !body.payload.events.length || body.payload.events.some((event: unknown, index: number) =>
        !record(event) || typeof event.type !== 'string' || !event.type || event.seq !== index || !Number.isFinite(event.time) || !Object.hasOwn(event, 'data'))
      || !Array.isArray(body.payload.files)) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '请选择有效员工和完整会话' }); return
    }
    const payload = Buffer.from(JSON.stringify(body.payload))
    // Limit counts raw file bytes and chat JSON, excluding transport base64 expansion.
    let bytes = Buffer.byteLength(JSON.stringify({ ...body.payload, files: [] }))
    for (const file of body.payload.files) {
      if (!record(file) || typeof file.data !== 'string' || typeof file.key !== 'string' || typeof file.name !== 'string'
        || !(/^[a-f0-9]{64}$/.test(file.key) || file.key.startsWith('path:') && file.key.length > 5)) {
        res.status(400).json({ code: 'INVALID_INPUT', message: '分享附件无效' }); return
      }
      const decoded = Buffer.from(file.data, 'base64')
      if (decoded.toString('base64') !== file.data) { res.status(400).json({ code: 'INVALID_INPUT', message: '分享附件编码无效' }); return }
      bytes += decoded.length
    }
    if (bytes > shares.policy().maxBytes) { res.status(413).json({ code: 'SHARE_TOO_LARGE', message: '聊天与文件总量超过分享上限' }); return }
    // Stored encoding is larger than the accounted payload, but remains bounded by HTTP admission.
    const share = shares.create({ id: res.locals.employee.id, name: String(res.locals.employee.name) }, body.title.trim(), body.recipients as string[], payload, bytes)
    res.status(201).json({ id: share.id, expiresAt: share.expiresAt })
  })
  app.use('/api/employee/session-shares', router)
  app.get('/api/admin/session-sharing', requireAdmin(options.auth), (_req, res) => res.json(shares.policy()))
  app.put('/api/admin/session-sharing', requireAdmin(options.auth), express.json({ limit: '8kb' }), (req, res) => {
    const body: unknown = req.body
    if (!validPolicy(body)) { res.status(400).json({ code: 'INVALID_INPUT', message: '保留期为 1–365 天，大小为 1KB–1GB' }); return }
    shares.configure(body)
    try {
      options.store.update(db => { db.operationLogs.unshift({ id: randomUUID(), time: new Date().toISOString(), operator: 'admin',
        type: 'update:session-sharing', object: 'session-sharing', change: `会话分享保留${body.retentionDays}天，单份上限${body.maxBytes}字节` }) })
    } catch (error) {
      console.error('分享配置已保存，但操作日志写入失败:', error instanceof Error ? error.name : 'unknown')
      res.status(503).json({ code: 'SHARE_POLICY_AUDIT_FAILED', message: '分享配置已保存，但操作日志写入失败，请联系管理员检查数据目录' }); return
    }
    res.json(shares.policy())
  })
  shares.cleanup()
  return shares
}
