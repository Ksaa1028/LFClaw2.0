# 独立管理端部署

[English](README.md) | 中文

<a id="独立管理端部署"></a>

桌面更新下载使用独立的 `desktop/win-x64/` 目录和 `/lfclaw-updates/win-x64/` 路径，清单不缓存，安装包支持 Range 请求；发布方法见[客户端更新发布](../desktop-release/README.zh.md)。该目录不属于管理端业务数据，管理端更新不删除它。

本文用于首次部署 Linux x64 管理端。服务器需要 Node.js 24 及 systemd；连接器使用 npx 时还需要 npm/npx。只上传管理端归档，不上传源码目录或本地业务数据。

## 1. 本地构建

<a id="1-本地构建"></a>

在仓库根目录执行，编号采用北京时间日期加当天递增序号，每次构建使用新编号：

```powershell
node LFClaw/08-构建运行/server-release/pack.mjs --version 2026102007 --target linux-x64
```

输出到 `.artifacts/lfclaw-admin/`。保留构建输出的 SHA256，上传完成后核对。归档包括管理员网页、企业 API 和运行依赖，服务器无需安装整个项目依赖。

## 2. 上传一个文件

<a id="2-上传一个文件"></a>

服务器执行：

```bash
mkdir -p /opt/lfclaw-enterprise/packages
```

上传归档到该目录。上传过程中使用 `.uploading` 后缀，完成后改回 `.tar.gz`，防止更新命令选中半包。

## 3. 首次安装

<a id="3-首次安装"></a>

以下示例对应公网 IP `8.216.38.213`、服务器内网网卡 `172.28.95.87`、端口 `39811`。执行前确认归档文件名与 SHA256 与本地构建结果一致。HTTP 传输不加密。

```bash
cd /opt/lfclaw-enterprise/packages
sha256sum lfclaw-admin-2026102007-linux-x64.tar.gz
```

核对通过后执行：

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

安装器检查端口、归档和目录身份，创建专用运行账户，用临时数据启动候选版本，通过后才启用 `lfclaw-enterprise-admin.service`。正式健康检查失败时恢复上一版本；首次失败保留数据和候选目录供排查。失败后不要直接重复覆盖，先查看错误。

员工独立绑定的企业 OAuth 可使用配套桌面客户端的临时本机回调，`publicOrigin` 保持当前公网 HTTP IP，无需域名或证书；授权码交换、令牌保存和工具调用仍在企业服务端。先更新服务端，再更新客户端。启动器仅在公开来源是 HTTPS 或本机地址时自动配置服务端 OAuth 回调；管理员共用账号及旧客户端使用此流程，公网 HTTP 未配置回调时返回明确错误。此类流程可在 `runtime.json` 显式设置有效的 HTTPS `oauthCallbackUrl` 及对应路由。无效的显式地址仍会阻止企业 API 启动。

## 4. 验证访问

<a id="4-验证访问"></a>

```bash
systemctl status lfclaw-enterprise-admin.service --no-pager -l
curl --fail http://172.28.95.87:39811/healthz
```

云安全组需要允许访问 TCP 39811，按实际管理人员来源设置范围。浏览器打开 `http://8.216.38.213:39811/`，账号 `admin`，密码是安装时输入的值。如内网健康检查成功而公网打不开，检查云安全组和服务器防火墙，不修改其他服务。

错误日志：

```bash
journalctl -u lfclaw-enterprise-admin.service -n 80 --no-pager
```

## 5. 后续更新

<a id="5-后续更新"></a>

管理脚本为本目录的 `lfclaw.sh`。已完成安装的服务器只需把该单文件上传到 `/opt/lfclaw-enterprise/lfclaw.sh`；不需要重新打包或重启。以后构建的管理端归档会携带该脚本，安装器在成功启用后将其放到这个位置。

```bash
bash /opt/lfclaw-enterprise/lfclaw.sh
```

不带参数显示启动、重启、状态、日志、更新、停止菜单；也可直接附加 `start`、`restart`、`status`、`logs`、`update`、`stop`。启动和重启会核对网页与企业 API 是否均就绪，失败时输出查看日志的命令。脚本需要 root；systemd 安装已启用开机启动，日常退出终端无需重复启动。

上传新编号的完整归档到同一 `packages/`，执行：

```bash
bash /opt/lfclaw-enterprise/lfclaw.sh update
```

安装器选择最新编号并核对全部内容；通过健康检查后保留当前和上一版程序及归档。`admin/data/` 保存业务记录、凭据、登录会话、技能、分享和备份；`admin/config/runtime.json` 保存运行设置；更新不会清空这两处。员工本机会话保存在各自设备上。

从 `2026102007` 修复 HTTP 企业 API 启动失败时，上传 `2026102008` 包并从新包提取 `deploy.mjs` 执行，以使用补充后的部署检查；无需重设管理员密码。新安装器同时要求 `/healthz` 返回正确发布编号、`/lfclaw/api/admin/status` 对未登录请求返回 `401` 和 `UNAUTHORIZED`，避免网页启动但 API 未启动时误报成功。

## 影响范围与验证限制

<a id="影响范围与验证限制"></a>

安装器管理自己的根目录、系统账户和 systemd 单元，不操作 `/opt/LfClaw`、`lfclaw.service`、Docker 或 nginx。`systemctl daemon-reload` 重新读取单元配置，不重启其他服务。新服务仍共享 CPU、内存、磁盘和网络；正式单元设置 CPUQuota=150%、MemoryHigh=1536M、MemoryMax=2G，具体连接器还需上线后验证资源用量。

归档校验测试和 Windows 归档启动、登录、重启持久化测试已通过；Linux 原生依赖及正式 systemd 启动由服务器临时检查和健康检查验证。本地不能替代服务器验收。客户端正式服务地址及本地运行约定见[客户端说明](../../01-客户端/README.zh.md)。
