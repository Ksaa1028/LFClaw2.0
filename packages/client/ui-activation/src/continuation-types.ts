/** 企业模型达到输出上限后的可回放续接提示来源。 */
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** 自动续接次数随提示持久化，恢复会话不重置次数上限。 */
    'lfclaw-output-continuation': { kind: 'lfclaw-output-continuation'; attempt: number } & ContextFormed
  }
}
