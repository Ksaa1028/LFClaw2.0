/** LFClaw 企业 API，供独立管理端 profile 与本地开发 profile 装载。 */
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createApp } from './app.ts'
import { AuthService } from './auth.ts'
import { JsonStore } from './store.ts'
import { SessionShares } from './session-sharing.ts'
import type { Limits } from './skill-archive.ts'

export const name = 'lfclaw-enterprise-api'
export const inject = ['webServer']

export interface Config {
  /** 技能 ZIP 压缩体积、解压体积和文件条目上限；需与员工端保持一致。 */
  skillArchiveLimits: Limits
  oauthCallbackUrl: string
  oauthFlowTtlMs: number
  dataDirectory: string
  routePrefix: string
  allowedOrigin: string
  initialPasswordEnv: string
  /** 兼容旧部署；楼层授权由网关执行，不再读取此环境变量。 */
  mcpSecretEnv?: string
  mcpTimeoutMs: number
  modelTimeoutMs: number
  expertTimeoutMs: number
  authWindowMs: number
  loginMaxFailures: number
  activationMaxFailures: number
  adminSessionTtlMs: number
  employeeSessionTtlMs: number
  /** 分享文件过期清理间隔，单位毫秒。 */
  shareCleanupIntervalMs: number
}

export const Config: z<Config> = z.object({
  skillArchiveLimits: z.object({
    maxArchiveBytes: z.number().step(1).min(1).required(),
    maxUnpackedBytes: z.number().step(1).min(1).required(),
    maxFiles: z.number().step(1).min(1).required(),
  }).default({ maxArchiveBytes: 33554432, maxUnpackedBytes: 67108864, maxFiles: 20000 }),
  oauthCallbackUrl: z.string().default(''),
  oauthFlowTtlMs: z.number().step(1).min(60000).default(600000),
  dataDirectory: z.string().required(),
  routePrefix: z.string().required(),
  allowedOrigin: z.string().required(),
  initialPasswordEnv: z.string().required(),
  mcpSecretEnv: z.string(),
  mcpTimeoutMs: z.number().step(1).min(1).required(),
  modelTimeoutMs: z.number().step(1).min(1).required(),
  expertTimeoutMs: z.number().step(1).min(1).required(),
  authWindowMs: z.number().step(1).min(1000).required(),
  loginMaxFailures: z.number().step(1).min(1).required(),
  activationMaxFailures: z.number().step(1).min(1).required(),
  adminSessionTtlMs: z.number().step(1).min(1000).required(),
  employeeSessionTtlMs: z.number().step(1).min(1000).required(),
  shareCleanupIntervalMs: z.number().step(1).min(1000).default(60000),
})

/** 注册企业 API；认证与数据文件在装载时校验。 */
export function apply(ctx: Context, config: Config): void {
  if (!config.routePrefix.startsWith('/') || config.routePrefix === '/' || config.routePrefix.endsWith('/')) {
    throw new Error('LFClaw routePrefix 必须是非根绝对路径，且不能以 / 结尾')
  }
  const dataDirectory = resolve(config.dataDirectory)
  mkdirSync(dataDirectory, { recursive: true })
  const store = new JsonStore(join(dataDirectory, 'db.json'))
  store.read()
  const auth = new AuthService(join(dataDirectory, 'admin-auth.json'), process.env[config.initialPasswordEnv],
    { adminMs: config.adminSessionTtlMs, employeeMs: config.employeeSessionTtlMs })
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'lfclaw: OAuth callback cleanup')
  const app = createApp({ store, auth, dataDirectory, signal: lifetime.signal, skillsDirectory: join(dataDirectory, 'skills'),
    skillArchiveLimits: config.skillArchiveLimits,
    oauthCallbackUrl: config.oauthCallbackUrl, oauthFlowTtlMs: config.oauthFlowTtlMs,
    allowedOrigin: config.allowedOrigin, mcpTimeoutMs: config.mcpTimeoutMs,
    expertTimeoutMs: config.expertTimeoutMs, modelTimeoutMs: config.modelTimeoutMs,
    authWindowMs: config.authWindowMs, loginMaxFailures: config.loginMaxFailures,
    activationMaxFailures: config.activationMaxFailures })
  const shares = new SessionShares(join(dataDirectory, 'session-shares'))
  ctx.effect(() => {
    const timer = setInterval(() => {
      try { shares.cleanup() }
      catch (error) { ctx.logger.error('分享过期清理失败，请检查磁盘与分享索引：%s', String(error)) }
    }, config.shareCleanupIntervalMs)
    timer.unref()
    return () => { clearInterval(timer) }
  }, 'lfclaw: share expiry cleanup')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: config.routePrefix,
    handler: (request, response) => {
      request.url = `/api${(request.url ?? '').slice(config.routePrefix.length)}`
      app(request, response)
    },
  }), `lfclaw-enterprise-api: ${config.routePrefix}`)
}
