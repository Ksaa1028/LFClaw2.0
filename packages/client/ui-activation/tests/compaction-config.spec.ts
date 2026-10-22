import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { BasicCompactionConfig } from '../../../compaction/compaction-basic/src/types.ts'
import { resolveConfig, resolveTargetPolicy, resolveCompactSpec } from '../../../compaction/compaction-basic/src/config.ts'

function compactors(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(compactors)
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [...(record.name === '@deepseek-ai/dsh-compaction-basic' ? [record] : []), ...Object.values(record).flatMap(compactors)]
}
it.each(['standard', 'ptc', 'cordis'])('实际 %s 预设的自动压缩能容纳旧的 32K 企业模型', (name) => {
  const tree: unknown = loadOverlayPatches(
    'LFClaw test',
    fileURLToPath(new URL('../../../bundle/web-app/presets/' + name + '.patch.yml', import.meta.url)),
  )
  const rows = compactors(tree)
  expect(rows).toHaveLength(1)
  const config = resolveConfig(rows[0]?.config as BasicCompactionConfig)
  expect(config.auto).toBe(true)
  const policy = resolveTargetPolicy(config, { provider: 'lfclaw', model: 'enterprise-model' })
  const spec = resolveCompactSpec(policy, 32768, 8192)
  expect(spec.thresholdTokens).toBeLessThan(32768 - 8192)
  expect(spec.retainTokens).toBeLessThan(spec.thresholdTokens)
  expect(spec.maxTokens).toBe(4096)
})
