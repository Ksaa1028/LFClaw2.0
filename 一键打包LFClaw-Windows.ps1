# Build an unsigned Windows installer connected to the deployed LFClaw enterprise service.
param(
  [string]$ReleaseId,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$desktopRoot = Join-Path $repoRoot 'apps/desktop'
$bundleDir = Join-Path $desktopRoot '.desktop-build/release-bundles'
$env:LFCLAW_SERVER_URL = 'http://8.216.38.213:39811/lfclaw/api'
$env:LFCLAW_DESKTOP_UPDATE_URL = 'http://8.216.38.213:39811/lfclaw-updates/win-x64/'
if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_CUSTOM_DIR = '{{ version }}'
}

Push-Location $repoRoot
try {
  foreach ($command in @('node', 'pnpm', 'tar')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing required command: $command" }
  }
  if ([string]::IsNullOrWhiteSpace($ReleaseId)) {
    $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyyMMdd')
    $sequence = 1
    if (Test-Path -LiteralPath $bundleDir) {
      foreach ($file in Get-ChildItem -LiteralPath $bundleDir -File) {
        if ($file.Name -match "^lfclaw-win-x64-$today(\d{2})\.(tar\.gz|reserved)$") {
          $sequence = [Math]::Max($sequence, [int]$Matches[1] + 1)
        }
      }
    }
    if ($sequence -gt 99) { throw 'All release IDs for today have been used in this checkout.' }
    $ReleaseId = '{0}{1:00}' -f $today, $sequence
  }
  $version = & node 'apps/desktop/scripts/lfclaw-release-id.mjs' $ReleaseId
  if ($LASTEXITCODE -ne 0) { throw 'Invalid release ID. Use YYYYMMDDxx with a sequence from 01 to 99.' }
  $version = $version.Trim()
  $archive = Join-Path $bundleDir "LFClaw-$ReleaseId-windows-x64.exe"
  $generated = Join-Path $bundleDir "../targets/win-x64/unsigned-artifacts/deepseek-harness-$version-win-x64-unsigned.exe"
  $reservation = Join-Path $bundleDir "lfclaw-win-x64-$ReleaseId.reserved"
  foreach ($path in @($archive, $generated, $reservation)) {
    if (Test-Path -LiteralPath $path) { throw "Release ID already used locally: $path" }
  }
  Write-Host "LFClaw release $ReleaseId, Desktop version $version"
  if ($CheckOnly) {
    & pnpm --dir apps/desktop run check:package -- win-x64 --unsigned --build-version $version
    if ($LASTEXITCODE -ne 0) { throw 'Packaging configuration check failed.' }
    exit 0
  }
  New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null
  # Retain the reservation after failure so another run cannot reuse partially built bytes.
  $handle = [IO.File]::Open($reservation, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $handle.Dispose()
  Write-Host '[1/2] 正在准备项目依赖……'
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  Write-Host '[2/2] 正在打包 Windows x64 客户端（无需签名证书）……'
  & pnpm run package:desktop:win:x64:unsigned --build-version $version
  if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed. See apps/desktop/.desktop-build/packaging-runs for stage logs.' }
  if (-not (Test-Path -LiteralPath $generated -PathType Leaf)) { throw "Expected installer was not created: $generated" }
  Write-Host '正在验证客户端界面启动……'
  $client = Join-Path $desktopRoot '.desktop-build/targets/win-x64/unsigned-artifacts/win-unpacked/LFClaw.exe'
  & node 'apps/web/tests/smoke-desktop-boot.mjs' $client
  if ($LASTEXITCODE -ne 0) { throw 'Desktop interface startup check failed. The installer has not been copied to the delivery folder.' }
  [IO.File]::Copy($generated, $archive, $false)
  Write-Host "SUCCESS: $archive" -ForegroundColor Green
  Write-Host '安装包已生成，可直接运行安装。未上传任何文件。'
  try { Start-Process explorer.exe -ArgumentList ('"{0}"' -f $bundleDir) }
  catch { Write-Warning "Installer created, but its folder could not be opened: $bundleDir" }
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Pop-Location
}
