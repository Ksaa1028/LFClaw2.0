param(
    [switch]$RebuildDesktop
)

# 本地只运行客户端；企业 API 与管理员页面统一使用正式服务器。
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$serverUrl = 'http://8.216.38.213:39811'
Set-Location -LiteralPath $workspace
$env:LFCLAW_SERVER_URL = "$serverUrl/lfclaw/api"
$env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'

if (!(Test-Path -LiteralPath (Join-Path $workspace 'node_modules'))) {
    throw 'Dependencies are missing. Run pnpm install in the project first.'
}
Write-Host "Enterprise API: $env:LFCLAW_SERVER_URL"
try {
    $health = Invoke-RestMethod -Uri "$serverUrl/healthz" -TimeoutSec 10
    if ($health.product -ne 'lfclaw-enterprise-admin' -or $health.ready -ne $true) {
        throw 'The production server is not ready.'
    }
    $null = Invoke-RestMethod -Uri "$env:LFCLAW_SERVER_URL/branding" -TimeoutSec 10
} catch {
    throw "Cannot reach the production enterprise service at $serverUrl. Check its service and network, then retry. $($_.Exception.Message)"
}
Write-Host "Admin: $serverUrl/"
Write-Host 'Close any already-running LFClaw client before continuing; its server address is set at startup.'
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
if ($RebuildDesktop -or !(Test-Path -LiteralPath (Join-Path $workspace 'apps/desktop/lib/main.js'))) {
    & $pnpm run dev:desktop
} else {
    & $pnpm run start:desktop
}
exit $LASTEXITCODE
