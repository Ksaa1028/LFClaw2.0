export type {} from './continuation-types.ts'
import { registerOutputContinuation } from './continuation.ts'
import { EnterpriseConnection } from './connection.ts'
export { EnterpriseConnection } from './connection.ts'
import type {} from '@deepseek-ai/dsh-agent'
/** LFClaw 员工激活的 Host 入口。 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { EnterpriseModels } from './models.ts'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { EnterpriseActivation, enterpriseUrl } from './enterprise.ts'

/** 企业激活插件标识。 */
export const name = 'lfclaw-activation'
/** 本机认证路由与凭据持久化服务。 */
export const inject = ['connection', 'credentials', 'llm', 'agentDefaultModel', 'agents']
/** 企业服务地址与请求超时，均由部署配置提供。 */
export interface Config {
  /** 每个人工请求允许的自动输出续接次数，0 关闭续接。 */
  maxAutoContinuations: number
  /** 连续空输出或重复输出达到此次数时停止自动续接。 */
  maxNoProgressContinuations: number
  /** 企业模型请求失败时的最多重试次数。 */
  modelMaxRetries: number
  /** 企业 API 根地址，员工令牌仅发送到该地址。 */
  serverUrl: string
  /** 明确允许公网 HTTP 部署；流量不加密。 */
  allowInsecureHttp: boolean
  /** 企业 API 请求超时，单位毫秒。 */
  timeoutMs: number
  /** 旧服务器未下发模型容量时使用的上下文窗口。 */
  contextWindow: number
  /** 旧服务器未下发模型容量时使用的单次输出上限。 */
  maxTokens: number
  /** 企业授权目录的后台刷新间隔，单位毫秒。 */
  refreshIntervalMs: number
}
/** 启动时校验部署参数。 */
export const Config: z<Config> = z.object({
  maxAutoContinuations: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(3),
  maxNoProgressContinuations: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2),
  modelMaxRetries: z.number().step(1).min(0).required(),
  serverUrl: z.string().required(),
  allowInsecureHttp: z.boolean().default(false),
  timeoutMs: z.number().min(1).required(),
  contextWindow: z.number().min(1).required(),
  maxTokens: z.number().min(1).required(),
  refreshIntervalMs: z.number().min(1000).required(),
})

/**
 * 注册本机受认证的激活接口，不向渲染层返回令牌。
 * @param ctx - Host 上下文。
 * @param config - 企业部署参数。
 */
export function apply(ctx: Context, config: Config): void {
  registerOutputContinuation(ctx, { ...config, provider: 'lfclaw' })
  const key = credentialKey(name, 'employee')
  const serverUrl = enterpriseUrl(config.serverUrl, config.allowInsecureHttp)
  const storage = {
    read: async () => {
      const value = await ctx.credentials.readRecord(key)
      return value?.kind === 'grant' ? value.payload : undefined
    },
    write: async (payload: { serverUrl: string; token: string }) => {
      await ctx.credentials.modifyRecord(key, () => Promise.resolve({ kind: 'grant', payload }))
    },
    clear: () => ctx.credentials.deleteRecord(key),
  }
  new EnterpriseConnection(ctx, serverUrl, config.timeoutMs, storage)
  const activation = new EnterpriseActivation(serverUrl, config.timeoutMs, storage)
  const models = new EnterpriseModels(
    {
      modelMaxRetries: config.modelMaxRetries,
      timeoutMs: config.timeoutMs,
      contextWindow: config.contextWindow,
      maxTokens: config.maxTokens,
      serverUrl,
    },
    storage,
    () => {
      ctx.emit('llm/adapters-updated')
    },
    async (ids, preferred) => {
      const current = ctx.agentDefaultModel.currentSelection()
      if (current.provider !== 'lfclaw' || !ids.includes(current.model))
        await ctx.agentDefaultModel.saveSelection({ provider: 'lfclaw', model: preferred })
    },
  )
  ctx.effect(() => ctx.llm.registerAdapter(['lfclaw'], models), 'lfclaw: enterprise models')
  ctx.effect(() => {
    const timer = setInterval(() => {
      void models.refresh().catch(() => {
        /* 目录与调用接口会显示连接失败；撤回旧目录后等待下次刷新。 */
      })
    }, config.refreshIntervalMs)
    return () => {
      clearInterval(timer)
    }
  }, 'lfclaw: model authorization refresh')
  for (const operation of ['status', 'branding', 'activate', 'logout'])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `/api/lfclaw/${operation}`,
          methods: operation === 'status' || operation === 'branding' ? ['GET'] : ['POST'],
          requestBody: 'buffered',
          fetch: request => activation.handle(request),
        }),
      `lfclaw: ${operation}`,
    )
}
