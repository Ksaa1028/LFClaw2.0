/** 管理端显示的主机基础指标，取样时即时计算。 */
import { cpus, freemem, totalmem } from 'node:os'
import { statfsSync } from 'node:fs'

export function readSystemStatus(dataDirectory: string) {
  const cpu = process.cpuUsage()
  const elapsed = Math.max(process.uptime(), 0.001)
  const cpuPercent = Math.min(100, Math.round((cpu.user + cpu.system) / 1_000_000 / elapsed / Math.max(cpus().length, 1) * 100))
  const memoryPercent = Math.round((1 - freemem() / totalmem()) * 100)
  let diskPercent: number | null = null
  try {
    const disk = statfsSync(dataDirectory)
    if (disk.blocks > 0) diskPercent = Math.round((1 - disk.bavail / disk.blocks) * 100)
  } catch (error) {
    console.error('LFClaw 磁盘指标读取失败:', error instanceof Error ? error.name : 'unknown')
  }
  return { cpuPercent, memoryPercent, diskPercent, gatewayStatus: 'online' as const }
}
