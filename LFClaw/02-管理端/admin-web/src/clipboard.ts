/**
 * 将文本复制到剪贴板；HTTP 页面或浏览器拒绝新接口时使用选中文本复制。
 * @param text - 用户点击复制的文本。
 * @returns 浏览器是否确认复制成功；失败时由页面保留原文本并提示手动复制。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_error) {
      // 权限拒绝不代表传统复制不可用，继续在页面内选中文本复制。
    }
  }
  const focused = document.activeElement
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.top = '0'
  input.style.left = '0'
  try {
    document.body.append(input)
    input.select()
    input.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch (_error) {
    // 复制权限或旧接口也不可用时返回失败，不向用户报告成功。
    return false
  } finally {
    input.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }
}
