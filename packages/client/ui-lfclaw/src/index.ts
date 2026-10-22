/** Expert center proxy retains employee credentials in the Host. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-ui-activation'
import { expertRequest } from './proxy.ts'
import type {} from '@deepseek-ai/dsh-skill'
import { EXPERT_MANAGER_SKILL } from './manager-name.ts'
import { expertManagerInstructions } from './expert-manager-skill.ts'
import { mountExpertTools } from './manager-tools.ts'
import { mountSharing } from './sharing.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Persistent directory for received share output files. */
export interface Config {
  /** Persistent local directory containing output files from claimed shares. */
  sharedSessionDirectory: string
  /** Maximum age in milliseconds of the Host directory snapshot used for expert lists. */
  expertCatalogMaxAgeMs: number
}
/** Validate local share storage configuration. */
export const Config: z<Config> = z.object({
  sharedSessionDirectory: z.string().default(join(homedir(), '.lfclaw', 'shared-sessions')),
  expertCatalogMaxAgeMs: z.number().step(1).min(0).default(30000),
})

/** Expert center Host plugin identifier. */
export const name = 'lfclaw-experts'
/** Required Host services. */
export const inject = ['connection', 'enterpriseConnection', 'skills', 'tools']
/** Register authenticated employee operations. @param ctx - Host context. @param config - Local share storage policy. */
export function apply(
  ctx: Context,
  config: Config = { sharedSessionDirectory: join(homedir(), '.lfclaw', 'shared-sessions'), expertCatalogMaxAgeMs: 30000 },
): void {
  ctx.inject(
    ['sessionQuery', 'sessionPersistence', 'agents', 'sessions', 'attachments', 'fs', 'sessionTitle', 'agentDefaultModel'],
    (scope) => {
      mountSharing(scope, config.sharedSessionDirectory)
    },
  )
  ctx.effect(
    () =>
      ctx.skills.register({
        name: EXPERT_MANAGER_SKILL,
        displayName: '专家管理',
        description: '通过对话创建和修改个人专家、专家团，并组合当前有权使用的技能与连接器。',
        source: 'bundled',
        content: expertManagerInstructions,
      }),
    'lfclaw: expert manager skill',
  )
  mountExpertTools(ctx)
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/lfclaw/expert-runtime',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => Response.json({ remoteExpert: true }, { headers: { 'Cache-Control': 'no-store' } }),
      }),
    'lfclaw: expert runtime readiness',
  )
  for (const [path, methods] of [
    ['expert-center', ['GET']],
    ['expert-prepare', ['POST']],
    ['personal-experts', ['POST']],
  ] as const)
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `/api/lfclaw/${path}`,
          methods: [...methods],
          requestBody: 'buffered',
          fetch: request =>
            expertRequest(request, (target, init) => ctx.enterpriseConnection.request(target, init), config.expertCatalogMaxAgeMs),
        }),
      `lfclaw: ${path}`,
    )
}
