import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { copyText } from '../src/clipboard.ts'

async function withBrowser(run: (window: JSDOM['window']) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<!doctype html><button id="copy">Copy</button>', { url: 'http://8.216.38.213:39811' })
  const previous = new Map(['document', 'navigator', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of previous.keys()) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as 'document' | 'navigator' | 'HTMLElement'] })
  try { await run(dom.window) }
  finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

test('公网 HTTP 无剪贴板新接口时复制选中文本，清理输入并恢复焦点', async () => {
  await withBrowser(async window => {
    const button = window.document.getElementById('copy')
    button?.focus()
    let copied = ''
    Object.defineProperty(window.document, 'execCommand', { value: (command: string) => {
      assert.equal(command, 'copy')
      const input = window.document.querySelector('textarea')
      assert.ok(input)
      assert.equal(input.selectionEnd, input.value.length)
      copied = input.value
      return true
    } })
    assert.equal(await copyText('LF-TEST-CODE'), true)
    assert.equal(copied, 'LF-TEST-CODE')
    assert.equal(window.document.querySelector('textarea'), null)
    assert.equal(window.document.activeElement, button)
  })
})

test('新接口完成前不报告成功，成功后不调用旧接口', async () => {
  await withBrowser(async window => {
    let finish: () => void = () => { throw new Error('copy not started') }
    let complete = false
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (text: string) => {
      assert.equal(text, 'LF-TEST')
      return new Promise<void>(resolve => { finish = resolve })
    } } })
    Object.defineProperty(window.document, 'execCommand', { value: () => { throw new Error('unexpected fallback') } })
    const copying = copyText('LF-TEST').then(result => { complete = true; return result })
    await Promise.resolve()
    assert.equal(complete, false)
    finish()
    assert.equal(await copying, true)
  })
})

test('新接口拒绝后使用传统复制', async () => {
  await withBrowser(async window => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Permission denied') } } })
    let calls = 0
    Object.defineProperty(window.document, 'execCommand', { value: () => { calls++; return true } })
    assert.equal(await copyText('LF-TEST'), true)
    assert.equal(calls, 1)
  })
})

test('浏览器拒绝或抛出复制错误时返回失败并清理输入', async () => {
  for (const throws of [false, true]) await withBrowser(async window => {
    Object.defineProperty(window.document, 'execCommand', { value: () => {
      if (throws) throw new Error('Blocked')
      return false
    } })
    assert.equal(await copyText('LF-TEST'), false)
    assert.equal(window.document.querySelector('textarea'), null)
  })
})
