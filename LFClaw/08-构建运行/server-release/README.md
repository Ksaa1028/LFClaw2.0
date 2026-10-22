# Standalone Administration Deployment

English | [中文](README.zh.md)

<a id="独立管理端部署"></a>

Desktop downloads use the separate `desktop/win-x64/` directory and `/lfclaw-updates/win-x64/` route. Manifests are not cached; installers support Range requests. See [desktop publication](../desktop-release/README.md). Administration updates preserve this directory, which is separate from business data.

This guide covers initial Linux x64 administration deployment. The server requires Node.js 24 and systemd, plus npm/npx for connectors that invoke npx. Upload only the administration archive, never the source checkout or local business data.

## 1. Build locally

<a id="1-本地构建"></a>

Run from the repository root. Release IDs combine the Beijing date and an increasing daily sequence; use a new ID for each build:

```powershell
node LFClaw/08-构建运行/server-release/pack.mjs --version 2026102007 --target linux-x64
```

Output goes to `.artifacts/lfclaw-admin/`. Keep the printed SHA256 and compare after upload. The archive includes administration pages, enterprise APIs and runtime dependencies, so the server does not install the entire workspace.

## 2. Upload one file

<a id="2-上传一个文件"></a>

On the server:

```bash
mkdir -p /opt/lfclaw-enterprise/packages
```

Upload the archive there with an `.uploading` suffix, renaming to `.tar.gz` only on completion so update selection cannot consume a partial archive.

## 3. Initial installation

<a id="3-首次安装"></a>

These examples use public IP `8.216.38.213`, private interface `172.28.95.87` and port `39811`. Confirm the archive name and SHA256 against the local build before execution. HTTP is unencrypted.

```bash
cd /opt/lfclaw-enterprise/packages
sha256sum lfclaw-admin-2026102007-linux-x64.tar.gz
```

After verification:

```bash
bash <<'SH'
set -e
cd /opt/lfclaw-enterprise/packages
installer=$(mktemp /tmp/lfclaw-admin-install-XXXXXX.mjs)
trap 'rm -f -- "$installer"; unset LFCLAW_ADMIN_PASSWORD' EXIT
tar -xOf lfclaw-admin-2026102007-linux-x64.tar.gz deploy.mjs > "$installer"
read -r -s -p '设置管理员密码（至少12位）: ' LFCLAW_ADMIN_PASSWORD </dev/tty
printf '\n'
export LFCLAW_ADMIN_PASSWORD
node "$installer" ./lfclaw-admin-2026102007-linux-x64.tar.gz --host 172.28.95.87 --origin http://8.216.38.213:39811
SH
```

The installer checks port availability, archive integrity and directory identity, creates a dedicated runtime user and starts the candidate with temporary data before enabling `lfclaw-enterprise-admin.service`. Failed production health checks restore the previous version. Initial failure preserves data and the candidate for diagnosis. Inspect errors before retrying an overwrite.

Employee-owned enterprise OAuth can use the accompanying desktop temporary loopback callback while `publicOrigin` remains the public HTTP IP, without a domain or certificate. Code exchange, token storage and tool calls remain server-side. Update the server before clients. The launcher automatically configures a server OAuth callback only for HTTPS or local origins; shared administrator accounts and older clients use this flow, which fails explicitly for public HTTP without a callback. Configure a valid HTTPS `oauthCallbackUrl` and route in `runtime.json` for that case. Invalid explicit addresses prevent enterprise API startup.

## 4. Verify access

<a id="4-验证访问"></a>

```bash
systemctl status lfclaw-enterprise-admin.service --no-pager -l
curl --fail http://172.28.95.87:39811/healthz
```

Allow TCP 39811 in the cloud security group, restricted to appropriate administrator sources. Open `http://8.216.38.213:39811/` and log in as `admin` with the installation password. If private health checks pass but public access fails, inspect the security group and host firewall without modifying other services.

Error logs:

```bash
journalctl -u lfclaw-enterprise-admin.service -n 80 --no-pager
```

## 5. Subsequent updates

<a id="5-后续更新"></a>

The management script is `lfclaw.sh` in this directory. Existing installations can upload that single file to `/opt/lfclaw-enterprise/lfclaw.sh` without rebuilding or restarting. Later administration archives carry it, and successful installation places it there.

```bash
bash /opt/lfclaw-enterprise/lfclaw.sh
```

Without arguments, the script shows start, restart, status, logs, update and stop choices; these are also direct `start`, `restart`, `status`, `logs`, `update` and `stop` arguments. Start and restart verify both pages and enterprise API readiness and provide a log command on failure. Root is required. Installation enables systemd startup; closing a terminal requires no restart.

Upload a complete archive with a new ID to the same `packages/` directory, then run:

```bash
bash /opt/lfclaw-enterprise/lfclaw.sh update
```

The installer selects the newest ID and verifies all contents. After healthy activation, it retains current and previous programs and archives. `admin/data/` stores business records, credentials, login sessions, skills, shares and backups; `admin/config/runtime.json` stores settings. Updates preserve both. Employee sessions remain on their own devices.

When repairing the HTTP enterprise API startup failure in `2026102007`, upload `2026102008` and run `deploy.mjs` extracted from that newer archive to use its additional checks; do not reset the administrator password. The installer requires `/healthz` to report the correct release and unauthenticated `/lfclaw/api/admin/status` to return `401` with `UNAUTHORIZED`, preventing a healthy page from masking a failed API.

## Scope and verification limits

<a id="影响范围与验证限制"></a>

The installer manages only its root, system account and systemd unit, never `/opt/LfClaw`, `lfclaw.service`, Docker or nginx. `systemctl daemon-reload` reloads unit definitions without restarting other services. CPU, memory, disk and networking remain shared; the production unit sets CPUQuota=150%, MemoryHigh=1536M and MemoryMax=2G. Validate individual connector resource usage after deployment.

Archive verification and Windows archive startup, login and restart-persistence tests have passed. Server candidate and health checks verify Linux native dependencies and systemd startup; local checks do not replace server acceptance. See [client guidance](../../01-客户端/README.md) for production service addresses and local operation.
