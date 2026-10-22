# LFClaw 管理端

[English](README.md) | 中文

<a id="lfclaw-管理端"></a>

管理端包括 [企业 API](server/README.zh.md) 与 [管理员 Web](admin-web/README.zh.md)。API 是 Cordis 插件，正式部署通过专用 `lfclaw-admin` profile 启动；运行步骤见[独立管理端发布](../08-构建运行/server-release/README.zh.md)。

## 数据与配置

<a id="数据与配置"></a>

首次初始化使用 `LFCLAW_ADMIN_PASSWORD`（至少 12 字符）与独立 `LFCLAW_DATA_DIR`。已有密码哈希不被新的初始化环境变量覆盖。`server/data/` 可能含业务数据与密钥，已忽略 Git，不得加入源码提交。

独立服务在配置端口提供管理网页和 `/lfclaw/api`。正式客户端使用已配置企业服务；自动化测试使用隔离目录和模拟传输，不能对正式业务数据运行增删改夹具。

## 开发与验收

<a id="开发与验收"></a>

管理端开发代理由 `admin-web/vite.config.ts` 定义，可通过 `VITE_LFCLAW_API_URL` 指定接口。具体启动、构建与权限行为由两个子目录的说明维护；发布与恢复按版本归档流程执行。

实际运行证据记录在[工作日志](../07-工作日志/README.zh.md)，页面展示或成功提示本身不代表后端验收通过。
