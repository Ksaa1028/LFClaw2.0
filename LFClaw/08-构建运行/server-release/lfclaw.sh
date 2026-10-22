#!/usr/bin/env bash
# LFClaw 独立管理端操作入口；业务数据由安装器保留。
set -euo pipefail

root=/opt/lfclaw-enterprise
unit=lfclaw-enterprise-admin.service

usage() {
  printf '%s\n' \
    '用法：bash /opt/lfclaw-enterprise/lfclaw.sh [操作]' \
    'start    启动并检查网页和企业 API' \
    'restart  重启并检查网页和企业 API' \
    'stop     停止管理端' \
    'status   查看运行状态' \
    'logs     查看最近 80 条日志' \
    'update   安装 packages 内最新编号的完整管理端包' \
    '不带操作时显示菜单；已启用开机自动启动。'
}

check_health() {
  /usr/bin/node --input-type=module - "$root" <<'JS'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.argv[2]
try {
  const { checkHealth } = await import(pathToFileURL(join(root, 'admin/deploy.mjs')).href)
  const config = JSON.parse(readFileSync(join(root, 'admin/config/runtime.json'), 'utf8'))
  const release = JSON.parse(readFileSync(join(root, 'admin/live/release.json'), 'utf8'))
  for (let attempt = 0; attempt < 20; attempt++) {
    let healthy = false
    try { healthy = await checkHealth(config, release.releaseId) }
    catch (error) {
      // 启动窗口内连接可能尚未建立；到期统一报告检查失败。
      if (!(error instanceof Error)) throw error
    }
    if (healthy) {
      console.log(`管理端已就绪：${config.publicOrigin}/；版本 ${release.releaseId}`)
      process.exit(0)
    }
    await new Promise(done => setTimeout(done, 1000))
  }
  throw new Error('网页或企业 API 未通过检查，服务状态需要查看日志确认')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error('查看日志：bash /opt/lfclaw-enterprise/lfclaw.sh logs')
  process.exitCode = 1
}
JS
}

action=${1:-}
if [[ "$action" == '--help' || "$action" == '-h' || "$action" == 'help' ]]; then
  usage
  exit 0
fi
if [[ $# -gt 1 ]]; then usage >&2; exit 2; fi
if [[ $EUID -ne 0 ]]; then
  printf '%s\n' '请用 root 执行，或在命令前加 sudo。' >&2
  exit 1
fi
if [[ ! -f "$root/admin/config/runtime.json" || ! -f "$root/admin/deploy.mjs" ]]; then
  printf '%s\n' '尚未找到已安装的独立管理端，请先完成首次安装。' >&2
  exit 1
fi
if [[ -z "$action" ]]; then
  printf '%s\n' 'LFClaw 管理端' '1. 启动' '2. 重启' '3. 查看状态' '4. 查看日志' '5. 更新到上传的最新包' '6. 停止' '0. 退出'
  if ! read -r -p '请输入序号：' choice; then exit 0; fi
  case "$choice" in
    1) action=start ;; 2) action=restart ;; 3) action=status ;;
    4) action=logs ;; 5) action=update ;; 6) action=stop ;;
    0) exit 0 ;; *) printf '%s\n' '无效序号。' >&2; exit 2 ;;
  esac
fi

case "$action" in
  start|restart)
    systemctl "$action" "$unit"
    check_health
    ;;
  stop)
    systemctl stop "$unit"
    printf '%s\n' '管理端已停止；需要恢复时执行 start。'
    ;;
  status) systemctl status "$unit" --no-pager -l ;;
  logs) journalctl -u "$unit" -n 80 --no-pager ;;
  update) /usr/bin/node "$root/admin/deploy.mjs" ;;
  *) usage >&2; exit 2 ;;
esac
