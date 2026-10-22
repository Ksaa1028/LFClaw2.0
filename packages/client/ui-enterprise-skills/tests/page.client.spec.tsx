// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillsPage } from '../src/client/SkillsPage.tsx'
import type {} from '../src/client/index.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
const t = makeTranslate(zh)
const catalog = {
  enterprise: [{ name: '企业日报', description: '授权技能', version: '2.0' }],
  personal: [{ name: 'report-helper', description: '个人日报', invocationName: 'my-report-helper', revision: 'r1' }],
  maxArchiveBytes: 100,
  refreshIntervalMs: 30000,
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('个人详情支持确认卸载，取消不发请求；失败保留详情供重试', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockResolvedValueOnce(Response.json({ code: 'failed' }, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ ...catalog, personal: [] }))
  vi.stubGlobal('fetch', transport)
  render(<SkillsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('企业日报')
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  fireEvent.click(screen.getByRole('button', { name: /查看 .* 的详情/ }))
  fireEvent.click(screen.getByRole('button', { name: '卸载技能' }))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(transport).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '卸载技能' }))
  fireEvent.click(screen.getByRole('button', { name: '确认卸载' }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.removeFailed)
  fireEvent.click(screen.getByRole('button', { name: '确认卸载' }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  await screen.findByText(zh.personalEmpty)
  expect(transport.mock.calls[2]?.[1].body).toBe(JSON.stringify({ name: 'report-helper' }))
})
it('展示授权目录，切换个人分类并通过对话创建或使用', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(catalog)))
  const startChat = vi.fn()
  render(<SkillsPage t={t} startChat={startChat} />)
  expect(await screen.findByText('企业日报')).toBeDefined()
  expect(screen.queryByText('report-helper')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  expect(screen.getByText('report-helper')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '对话创建' }))
  expect(startChat).toHaveBeenCalledWith(zh.creationPrompt)
  fireEvent.click(screen.getByRole('button', { name: /查看 .* 的详情/ }))
  expect(screen.getByRole('dialog')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
  expect(startChat).toHaveBeenLastCalledWith({
    text: '/my-report-helper ',
    references: [
      {
        source: 'skill',
        ref: '/my-report-helper',
        label: 'report-helper',
        clipboardText: '/my-report-helper',
        offset: 0,
        length: 17,
      },
    ],
  })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '找不到' } })
  expect(screen.getByText('没有匹配的技能')).toBeDefined()
})
it('导入失败保留原列表，超限文件不发送到 Host', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockResolvedValueOnce(Response.json({ code: 'duplicate' }, { status: 400 }))
  vi.stubGlobal('fetch', transport)
  const { container } = render(<SkillsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('企业日报')
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  const input = container.querySelector('input[type=file]')!
  fireEvent.change(input, { target: { files: [new File(['zip'], 'skill.zip')] } })
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh.duplicate)
  expect(screen.getByText('report-helper')).toBeDefined()
  fireEvent.change(input, { target: { files: [new File(['x'.repeat(101)], 'large.zip')] } })
  expect(screen.getByRole('alert').textContent).toBe(zh.archive)
  expect(transport).toHaveBeenCalledTimes(2)
})
it('导入成功重新读取列表，连接失败不会显示成功空列表', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...catalog, personal: [] }))
    .mockResolvedValueOnce(Response.json({ name: 'report-helper' }, { status: 201 }))
    .mockResolvedValueOnce(Response.json(catalog))
    .mockRejectedValueOnce(new Error('offline'))
  vi.stubGlobal('fetch', transport)
  const { container } = render(<SkillsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('企业日报')
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['zip'], 'skill.zip')] } })
  expect(await screen.findByText('report-helper')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe(zh.unavailable)
  })
  expect(screen.queryByText(zh.personalEmpty)).toBeNull()
})

it('优先显示企业上传图标，加载失败回退；刷新后采用新图标，无图标保持默认', async () => {
  const first = 'data:image/png;base64,Zmlyc3Q='
  const second = 'data:image/jpeg;base64,c2Vjb25k'
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...catalog, enterprise: [{ ...catalog.enterprise[0], icon: first }] }))
    .mockResolvedValueOnce(Response.json({ ...catalog, enterprise: [{ ...catalog.enterprise[0], icon: second }] }))
  vi.stubGlobal('fetch', transport)
  const { container } = render(<SkillsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('企业日报')
  expect(container.querySelector('img')?.getAttribute('src')).toBe(first)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('h2')?.previousElementSibling?.querySelector('svg')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  await waitFor(() => {
    expect(container.querySelector('img')?.getAttribute('src')).toBe(second)
  })
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('h2')?.previousElementSibling?.querySelector('svg')).not.toBeNull()
})

it('刷新失败保留已读取技能，禁止用户调用的技能不能从按钮启动', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        ...catalog,
        enterprise: [{ ...catalog.enterprise[0], invocationName: 'enterprise-report', userInvocable: false }],
      }),
    )
    .mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', transport)
  render(<SkillsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('企业日报')
  fireEvent.click(screen.getByRole('button', { name: /查看 .* 的详情/ }))
  expect(screen.getByRole('button', { name: '开始使用' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }))
  await screen.findByRole('alert')
  expect(screen.getByText('企业日报')).toBeDefined()
})
it('个人技能从详情进入对话修改，不显示参数编辑表单', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json(catalog))
  vi.stubGlobal('fetch', transport)
  const startChat = vi.fn()
  render(<SkillsPage t={t} startChat={startChat} />)
  await screen.findByText('企业日报')
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  fireEvent.click(screen.getByRole('button', { name: /查看 .* 的详情/ }))
  expect(screen.queryByRole('button', { name: '停用技能' })).toBeNull()
  expect(screen.queryByRole('button', { name: '启用技能' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '对话修改' }))
  expect(startChat).toHaveBeenCalledWith(zh.editPrompt.replace('{name}', 'report-helper'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(transport).toHaveBeenCalledTimes(1)
})
it('同名导入先确认替换；取消不会覆盖原技能', async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockResolvedValueOnce(Response.json({ code: 'duplicate', revision: 'r1', name: 'report-helper' }, { status: 409 }))
  vi.stubGlobal('fetch', transport)
  const { container } = render(<SkillsPage t={t} startChat={vi.fn()} />)
  await screen.findByText('企业日报')
  fireEvent.click(screen.getByRole('tab', { name: '我的技能' }))
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['zip'], 'skill.zip')] } })
  await screen.findByText(zh.replaceConfirm)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(transport).toHaveBeenCalledTimes(2)
  expect(screen.getByText('report-helper')).toBeDefined()
})

it('企业技能展示原名并通过引用保留唯一调用标识，同名技能不会混用', async () => {
  const enterprise = ['a', 'b'].map(id => ({
    name: 'skill-creator',
    id,
    description: `技能${id}`,
    invocationName: `enterprise-skill-creator-${id}`,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => Response.json({ ...catalog, enterprise })),
  )
  const startChat = vi.fn()
  render(<SkillsPage t={t} startChat={startChat} />)
  await screen.findAllByText('skill-creator')
  for (const [index, id] of ['a', 'b'].entries()) {
    fireEvent.click(screen.getAllByRole('button', { name: /查看 .* 的详情/ })[index]!)
    expect(screen.queryByText('调用名称')).toBeNull()
    expect(screen.queryByText(`enterprise-skill-creator-${id}`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    const ref = `/enterprise-skill-creator-${id}`
    expect(startChat).toHaveBeenLastCalledWith({
      text: `${ref} `,
      references: [{ source: 'skill', ref, label: 'skill-creator', clipboardText: ref, offset: 0, length: ref.length }],
    })
  }
})
