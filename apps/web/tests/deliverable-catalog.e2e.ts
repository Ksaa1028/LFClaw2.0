/** The shipped Web composition exposes final files from multiple Sessions in one sidebar page. */
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold({ developerTools: false })
  const first = scaffold.ctx.sessions.create(SessionId('catalog-report'), { meta: { cwd: scaffold.workspaceCwd } })
  const second = scaffold.ctx.sessions.create(SessionId('catalog-chart'), { meta: { cwd: scaffold.workspaceCwd } })
  await writeFile(join(scaffold.workspaceCwd, 'report.txt'), 'Current report\n')
  await writeFile(join(scaffold.workspaceCwd, 'chart.txt'), 'Current chart\n')
  first.append('deliverables/presented', {
    turn: 1,
    callId: ToolCallId('catalog-present-report'),
    files: [{ path: join(scaffold.workspaceCwd, 'report.txt'), description: 'Quarterly report' }],
  })
  second.append('deliverables/presented', {
    turn: 1,
    callId: ToolCallId('catalog-present-chart'),
    files: [{ path: join(scaffold.workspaceCwd, 'chart.txt'), description: 'Sales chart' }],
  })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
})

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

it('finds delivered files, previews a current file, and marks a removed source', async () => {
  await page.getByRole('button', { name: '成果中心' }).click()
  const catalog = page.locator('[data-present-catalog]')
  await expect.poll(() => catalog.getByText('report.txt').count()).toBe(1)
  await expect.poll(() => catalog.getByText('chart.txt').count()).toBe(1)
  await catalog.getByRole('searchbox', { name: '搜索文件名、描述或工作区' }).fill('quarterly')
  await expect.poll(() => catalog.getByText('report.txt').count()).toBe(1)
  await expect.poll(() => catalog.getByText('chart.txt').count()).toBe(0)
  await catalog.getByRole('button', { name: '预览' }).click()
  await expect.poll(() => page.getByText('Current report').count()).toBe(1)
  await rm(join(scaffold.workspaceCwd, 'report.txt'))
  await page.getByRole('button', { name: '成果中心' }).click()
  await catalog.getByRole('button', { name: '刷新' }).click()
  await expect.poll(() => catalog.getByText('原文件已不可用').count()).toBe(1)
  await expect
    .poll(() => catalog.locator('li').filter({ hasText: 'report.txt' }).getByRole('button', { name: '预览' }).isDisabled())
    .toBe(true)
  await expect
    .poll(() => catalog.locator('li').filter({ hasText: 'report.txt' }).getByRole('button', { name: '来源会话' }).count())
    .toBe(0)
  await expect
    .poll(() => catalog.locator('li').filter({ hasText: 'report.txt' }).locator('[data-source-session]').isEnabled())
    .toBe(true)
  await catalog.locator('li').filter({ hasText: 'report.txt' }).locator('[data-source-session]').click()
  await expect.poll(() => catalog.count()).toBe(0)
})

it('shows ten files at a time and navigates between pages', async () => {
  const chart = scaffold.ctx.sessions.get(SessionId('catalog-chart'))
  if (chart === undefined) throw new Error('Missing chart Session')
  for (let index = 0; index < 11; index++) {
    const path = join(scaffold.workspaceCwd, `chart-extra-${index}.txt`)
    await writeFile(path, `Chart ${index}\n`)
    chart.append('deliverables/presented', {
      turn: index + 2,
      callId: ToolCallId(`catalog-extra-${index}`),
      files: [{ path, description: `Extra chart ${index}` }],
    })
  }
  await page.getByRole('button', { name: '成果中心' }).click()
  const catalog = page.locator('[data-present-catalog]')
  await catalog.getByRole('button', { name: '刷新' }).click()
  await expect.poll(() => catalog.locator('li').count()).toBe(10)
  await expect.poll(() => catalog.getByText('第 1 / 2 页').count()).toBe(1)
  await catalog.getByRole('button', { name: '下一页' }).click()
  await expect.poll(() => catalog.locator('li').count()).toBe(3)
  await expect.poll(() => catalog.getByText('第 2 / 2 页').count()).toBe(1)
  await catalog.getByRole('button', { name: '上一页' }).click()
  await expect.poll(() => catalog.locator('li').count()).toBe(10)
})

it('confirms removal of one catalog entry while preserving the original file', async () => {
  await page.getByRole('button', { name: '成果中心', exact: true }).click()
  const catalog = page.locator('[data-present-catalog]')
  await catalog.getByRole('button', { name: '刷新' }).click()
  await catalog.getByRole('searchbox', { name: '搜索文件名、描述或工作区' }).fill('chart.txt')
  const row = catalog.locator('li').filter({ hasText: 'chart.txt' })
  await expect.poll(() => row.count()).toBe(1)
  await row.getByRole('button', { name: '从成果中心移除' }).click()
  const dialog = page.getByRole('dialog', { name: '移除成果记录' })
  await expect.poll(() => dialog.getByText('确认从成果中心移除“chart.txt”？磁盘上的原文件会保留').count()).toBe(1)
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect.poll(() => row.count()).toBe(1)
  await page.route('**/api/present.catalog', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 404, body: 'not found' })
    else await route.continue()
  })
  await row.getByRole('button', { name: '从成果中心移除' }).click()
  await dialog.getByRole('button', { name: '确认移除' }).click()
  await expect.poll(() => dialog.getByText('移除功能尚未在当前程序中启用，请重启 LFClaw 后重试').count()).toBe(1)
  await expect.poll(() => row.count()).toBe(1)
  await page.unroute('**/api/present.catalog')
  await dialog.getByRole('button', { name: '确认移除' }).click()
  await expect.poll(() => row.count()).toBe(0)
  await catalog.getByRole('button', { name: '刷新' }).click()
  await expect.poll(() => row.count()).toBe(0)
  await expect
    .poll(async () => (await import('node:fs/promises')).readFile(join(scaffold.workspaceCwd, 'chart.txt'), 'utf8'))
    .toBe('Current chart\n')
})
