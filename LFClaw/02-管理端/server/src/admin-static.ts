/** 独立管理端网页与版本健康检查；不装载聊天页面或远程执行接口。 */
import { readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-cmdline'
import express from 'express'
import z from '@deepseek-ai/schemastery'

export const name = 'lfclaw-admin-static'
export const inject = ['webServer', 'appReady']

/** 管理页位置和发布编号均由发布包启动配置提供。 */
export interface Config {
  webDirectory: string
  releaseId: string
  desktopDirectory?: string
}

export const Config: z<Config> = z.object({
  webDirectory: z.string().required(),
  releaseId: z.string().pattern(/^\d{10}$/).required(),
  desktopDirectory: z.string(),
})

/**
 * 注册管理页面和只读健康接口；启动完成前健康接口返回 503。
 * @param ctx - 专用 profile 的服务上下文。
 * @param config - 已验证的网页位置和版本。
 */
export function apply(ctx: Context, config: Config): void {
  const web = resolve(config.webDirectory)
  const index = join(web, 'index.html')
  if (!statSync(index).isFile()) throw new Error('管理端缺少 web/index.html，请重新打包')
  readFileSync(index)
  let ready = false
  const readiness = ctx.appReady
  if (!readiness) throw new Error('管理端必须通过 dsh profile 启动')
  ctx.effect(() => readiness.onReady(() => { ready = true }), 'lfclaw admin readiness')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/healthz',
    handler: (_request, response) => {
      response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ product: 'lfclaw-enterprise-admin', releaseId: config.releaseId, ready }))
    },
  }), 'lfclaw admin health')
  const app = express()
  app.disable('x-powered-by')
  if (config.desktopDirectory) {
    app.use('/lfclaw-updates/win-x64', express.static(resolve(config.desktopDirectory, 'win-x64'), {
      dotfiles: 'deny', index: false, redirect: false, fallthrough: false,
      setHeaders(response) { response.setHeader('Cache-Control', 'no-store') },
    }))
  }
  app.use(express.static(web, { dotfiles: 'deny', index: 'index.html', redirect: false,
    setHeaders(response) { response.setHeader('Cache-Control', 'no-cache') } }))
  app.use((_request, response) => { response.status(404).end() })
  ctx.effect(() => ctx.webServer.registerFallback((request, response) => {
    app(request, response)
  }), 'lfclaw admin static files')
}
