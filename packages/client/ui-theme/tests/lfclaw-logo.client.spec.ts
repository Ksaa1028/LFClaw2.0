// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '../src/styles/base.css'), 'utf8')
afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  document.body.removeAttribute('data-ds-dark-theme')
})

it('switches UI logos with the resolved theme and leaves gold artwork unfiltered', () => {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  const logo = document.createElement('img')
  logo.dataset.lfclawLogo = 'auto'
  const inverse = document.createElement('img')
  inverse.dataset.lfclawLogo = 'inverse'
  const gold = document.createElement('img')
  document.body.append(logo, inverse, gold)
  expect(getComputedStyle(logo).filter).toBe('brightness(0)')
  expect(getComputedStyle(inverse).filter).toBe('brightness(0) invert(1)')
  expect(getComputedStyle(gold).filter).toBe('none')
  document.body.setAttribute('data-ds-dark-theme', '')
  expect(getComputedStyle(logo).filter).toBe('brightness(0) invert(1)')
  expect(getComputedStyle(gold).filter).toBe('none')
  document.body.removeAttribute('data-ds-dark-theme')
  expect(getComputedStyle(logo).filter).toBe('brightness(0)')
})
