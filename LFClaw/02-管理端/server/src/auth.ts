import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { NextFunction, Request, Response } from 'express'

interface Credentials { salt: string; hash: string }
interface Session { principal: 'admin' | 'employee'; employeeId?: string; activationCodeHash?: string }
interface StoredSession extends Session { expiresAt: number }
/** 两种身份令牌从签发到过期的毫秒数。 */
export interface SessionLifetimes { adminMs: number; employeeMs: number }

function persist(path: string, value: unknown): void {
  const temporary = join(dirname(path), `.auth-${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function activationHash(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')
}

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 单管理员与持久化令牌摘要；服务器重启不会迫使员工重新激活。 */
export class AuthService {
  private credentials: Credentials
  private readonly sessions = new Map<string, StoredSession>()
  private readonly sessionsPath: string

  constructor(private readonly authPath: string, initialPassword: string | undefined,
    private readonly lifetimes: SessionLifetimes) {
    this.sessionsPath = join(dirname(authPath), 'sessions.json')
    if (existsSync(authPath)) {
      const value: unknown = JSON.parse(readFileSync(authPath, 'utf8'))
      if (!value || typeof value !== 'object' || !('salt' in value) || !('hash' in value)
        || typeof value.salt !== 'string' || typeof value.hash !== 'string') {
        throw new Error('管理员凭据文件无效；请修复文件后重启')
      }
      this.credentials = { salt: value.salt, hash: value.hash }
    } else {
      if (!initialPassword || initialPassword.length < 12) {
        throw new Error('首次启动请设置至少 12 字符的 LFCLAW_ADMIN_PASSWORD')
      }
      const salt = randomBytes(16).toString('hex')
      this.credentials = { salt, hash: hashPassword(initialPassword, salt) }
      writeFileSync(authPath, JSON.stringify(this.credentials) + '\n', { mode: 0o600, flag: 'wx' })
    }
    if (existsSync(this.sessionsPath)) {
      const saved: unknown = JSON.parse(readFileSync(this.sessionsPath, 'utf8'))
      if (!Array.isArray(saved) || saved.some(entry => !Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object'
        || !('principal' in entry[1]) || !['admin', 'employee'].includes(String(entry[1].principal))
        || ('expiresAt' in entry[1] && (typeof entry[1].expiresAt !== 'number'
          || !Number.isSafeInteger(entry[1].expiresAt))))) {
        throw new Error('会话文件无效；原文件已保留，请修复后重启')
      }
      let migrated = false
      for (const [hash, session] of saved as Array<[string, Session & { expiresAt?: number }]>) {
        if (session.expiresAt === undefined) migrated = true
        this.sessions.set(hash, { ...session, expiresAt: session.expiresAt
          ?? Date.now() + (session.principal === 'admin' ? lifetimes.adminMs : lifetimes.employeeMs) })
      }
      if (migrated) this.saveSessions()
    }
  }

  private saveSessions(): void { persist(this.sessionsPath, [...this.sessions]) }

  login(username: string, password: string): string | null {
    const candidate = hashPassword(password, this.credentials.salt)
    if (username !== 'admin' || !equalHex(candidate, this.credentials.hash)) return null
    return this.issue({ principal: 'admin' })
  }

  changePassword(currentPassword: string, nextPassword: string): string | null {
    if (nextPassword.length < 12) throw new Error('新密码至少需要 12 个字符')
    const candidate = hashPassword(currentPassword, this.credentials.salt)
    if (!equalHex(candidate, this.credentials.hash)) return null
    const salt = randomBytes(16).toString('hex')
    const next = { salt, hash: hashPassword(nextPassword, salt) }
    persist(this.authPath, next)
    this.credentials = next
    for (const [hash, session] of this.sessions) if (session.principal === 'admin') this.sessions.delete(hash)
    this.saveSessions()
    return this.issue({ principal: 'admin' })
  }

  issue(session: Session): string {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(tokenHash(token), { ...session,
      expiresAt: Date.now() + (session.principal === 'admin' ? this.lifetimes.adminMs : this.lifetimes.employeeMs) })
    this.saveSessions()
    return token
  }

  resolve(token: string | undefined): Session | undefined {
    if (!token) return undefined
    const hash = tokenHash(token)
    const session = this.sessions.get(hash)
    if (session && session.expiresAt <= Date.now()) { this.sessions.delete(hash); this.saveSessions(); return undefined }
    return session
  }

  logout(token: string | undefined): void {
    if (token && this.sessions.delete(tokenHash(token))) this.saveSessions()
  }

  invalidateEmployee(employeeId: string): void {
    let changed = false
    for (const [hash, session] of this.sessions) if (session.employeeId === employeeId) {
      this.sessions.delete(hash)
      changed = true
    }
    if (changed) this.saveSessions()
  }
}

export function bearerToken(req: Request): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.header('authorization') ?? '')
  return match?.[1]
}

export function requireAdmin(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (auth.resolve(bearerToken(req))?.principal !== 'admin') {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录管理员账号' })
      return
    }
    next()
  }
}
