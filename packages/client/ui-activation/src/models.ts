/** 企业授权目录与 DSH 模型适配器；员工令牌仅供 Host 使用。 */
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  LlmAdapter,
  LlmError,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  resolveRetryPolicy,
  type GenerateOptions,
  type StreamChunk,
  type PreparedAdapterCall,
} from '@deepseek-ai/dsh-llm'
import { estimateContent, estimateToolsTokens, ROLE_OVERHEAD } from '@deepseek-ai/dsh-token-meter/estimate'
import { PiAiAdapter, resolveProfiles, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ActivationStorage } from './enterprise.ts'

interface EnterpriseModel {
  id: string
  name: string
  isDefault: boolean
  contextWindow: number
  maxTokens: number
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

const networkCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
])

function networkFailure(error: unknown, depth = 0): boolean {
  if (depth > 4) return false
  const value = object(error)
  if (typeof value?.code === 'string' && networkCodes.has(value.code)) return true
  if (error instanceof AggregateError && error.errors.some(item => networkFailure(item, depth + 1))) return true
  return error instanceof Error && error.cause !== undefined && networkFailure(error.cause, depth + 1)
}

function enterpriseTransportError(error: unknown): unknown {
  return networkFailure(error)
    ? new LlmError('企业服务连接中断，请检查服务状态，并在工作区确认已生成的文件后重试', 'TRANSPORT', { cause: error })
    : error
}
/** 部署参数明确限制上下文与输出，不把上游未声明的能力作为已支持能力。 */
export interface EnterpriseModelsConfig {
  modelMaxRetries?: number
  serverUrl: string
  timeoutMs: number
  contextWindow: number
  maxTokens: number
}
/** 企业资源 ID 作为模型标识，实际提供商模型名称只由服务器解析。 */
export class EnterpriseModels extends LlmAdapter {
  private profiles = new Map<string, ResolvedPiAiProviderProfile>()
  private models: EnterpriseModel[] = []
  private revision = ''
  private pending: Promise<void> | undefined
  private readonly delegate: PiAiAdapter
  constructor(
    private readonly config: EnterpriseModelsConfig,
    private readonly storage: ActivationStorage,
    private readonly changed: () => void,
    private readonly defaultModel: (ids: readonly string[], preferred: string) => Promise<void>,
    private readonly transport: typeof fetch = fetch,
  ) {
    super()
    this.delegate = new PiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: () => this.token(),
      auth: {
        credentials: new InMemoryCredentialStore(),
        authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
      },
    })
  }
  override providerInfo() {
    return { id: 'lfclaw', name: '企业授权模型' }
  }
  override providerRetryPolicy() {
    return resolveRetryPolicy(
      this.config.modelMaxRetries === undefined ? undefined : { mode: 'normal', maxRetries: this.config.modelMaxRetries },
      'lfclaw.retryPolicy',
    )
  }
  private async token(): Promise<string> {
    const grant = object(await this.storage.read())
    if (grant?.serverUrl !== this.config.serverUrl || typeof grant.token !== 'string' || !grant.token)
      throw new LlmError('请先激活企业账号', 'AUTH')
    return grant.token
  }
  /** 更新授权目录；相同请求共享一次刷新。 @returns 目录刷新完成。 */
  refresh(): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.load().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }
  private async load(): Promise<void> {
    const grant = object(await this.storage.read())
    if (grant?.serverUrl !== this.config.serverUrl || typeof grant.token !== 'string') {
      this.install([])
      return
    }
    try {
      let response: Response
      try {
        response = await this.transport(`${this.config.serverUrl}/employee/me`, {
          headers: { Authorization: `Bearer ${grant.token}` },
          signal: AbortSignal.timeout(this.config.timeoutMs),
          redirect: 'error',
        })
      } catch (error) {
        throw enterpriseTransportError(error)
      }
      if (!response.ok)
        throw new LlmError(
          response.status === 401 ? '员工登录已失效，请重新激活' : '无法读取企业模型授权，请检查服务连接',
          'AUTH',
          { status: response.status },
        )
      const body = object(await response.json())
      if (!Array.isArray(body?.models)) throw new LlmError('企业模型目录响应无效', 'INVALID_RESPONSE')
      const models: EnterpriseModel[] = []
      for (const value of body.models) {
        const model = object(value)
        if (!model || typeof model.id !== 'string' || typeof model.name !== 'string')
          throw new LlmError('企业模型目录字段无效', 'INVALID_RESPONSE')
        if (model.type === 'text' && model.protocol === 'openai-compatible') {
          const contextWindow = model.contextWindow ?? this.config.contextWindow
          const maxTokens = model.maxTokens ?? this.config.maxTokens
          if (
            typeof contextWindow !== 'number' ||
            !Number.isSafeInteger(contextWindow) ||
            contextWindow <= 0 ||
            typeof maxTokens !== 'number' ||
            !Number.isSafeInteger(maxTokens) ||
            maxTokens <= 0 ||
            maxTokens > contextWindow
          ) {
            throw new LlmError('企业模型容量无效，请联系管理员检查上下文窗口和最大输出 token 数', 'INVALID_RESPONSE')
          }
          models.push({ id: model.id, name: model.name, isDefault: model.isDefault === true, contextWindow, maxTokens })
        }
      }
      this.install(models)
      const preferred = models.find(model => model.isDefault) ?? models[0]
      if (preferred)
        await this.defaultModel(
          models.map(model => model.id),
          preferred.id,
        )
    } catch (error) {
      this.install([])
      throw error
    }
  }
  private install(models: EnterpriseModel[]): void {
    const revision = JSON.stringify(models)
    if (revision === this.revision) return
    this.revision = revision
    this.models = models
    this.profiles = models.length
      ? resolveProfiles({
        lfclaw: {
          displayName: '企业授权模型',
          api: 'openai-completions',
          baseURL: `${this.config.serverUrl}/employee/v1`,
          models: models.map(model => ({
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            input: ['text'],
          })),
          compat: { supportsDeveloperRole: false, supportsStore: false },
          timeoutMs: this.config.timeoutMs,
        },
      })
      : new Map<string, ResolvedPiAiProviderProfile>()
    this.changed()
  }
  override async listModels(provider: string) {
    await this.refresh()
    return this.models.length ? this.delegate.listModels(provider) : []
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    if (!this.models.some(item => item.id === model)) throw new LlmError('此模型尚未授权或已被移除', 'MODEL_FORBIDDEN')
    return this.delegate.resolveModel(provider, model, signal)
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    await this.refresh()
    await this.resolveModel(provider, model, signal)
    const call = await this.delegate.prepareCall(provider, model, signal)
    const capacity = this.models.find(item => item.id === model)!
    return { model: call.model, stream: options => this.streamWithinCapacity(call, capacity, options) }
  }
  private async *streamWithinCapacity(
    call: PreparedAdapterCall,
    capacity: EnterpriseModel,
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    const tools = estimateToolsTokens({
      config: { provider: options.provider, model: options.model },
      ...(options.tools ? { tools: options.tools } : {}),
    })
    const messages = options.messages.reduce((sum, message) => sum + estimateContent(message.content) + ROLE_OVERHEAD, 0)
    const system = options.system ? estimateContent([{ type: 'text', text: options.system }]) + ROLE_OVERHEAD : 0
    const output = Math.min(options.maxTokens ?? capacity.maxTokens, capacity.maxTokens)
    if (tools + messages + system + output > capacity.contextWindow) {
      throw new LlmError(
        `上下文空间不足：本次输入估算 ${tools + messages + system} token（工具定义约 ${tools}），` +
          `另需预留 ${output} token 输出，超过当前配置的 ${capacity.contextWindow} token 窗口。` +
          '本次请求未发送；系统会尝试压缩可压缩的历史，仍不足时请缩小输入或由管理员核对模型真实容量。',
        CONTEXT_WINDOW_EXCEEDED_CODE,
      )
    }
    try {
      yield* call.stream(options)
    } catch (error) {
      throw enterpriseTransportError(error)
    }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const call = await this.prepareCall(options.provider, options.model, options.signal)
    try {
      yield* call.stream(options)
    } catch (error) {
      throw enterpriseTransportError(error)
    }
  }
}
