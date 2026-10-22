# LFClaw Administration

English | [中文](README.zh.md)

<a id="lfclaw-管理端"></a>

Administration includes the [enterprise API](server/README.md) and [administrator Web app](admin-web/README.md). The API is a Cordis plugin launched through the dedicated `lfclaw-admin` profile in production; see [server publication](../08-构建运行/server-release/README.md).

## Data and configuration

<a id="数据与配置"></a>

Initial setup uses `LFCLAW_ADMIN_PASSWORD` (at least 12 characters) and a dedicated `LFCLAW_DATA_DIR`. A new initialization environment variable does not overwrite an existing password hash. `server/data/` may contain business data and secrets; it is Git-ignored and must not enter source commits.

The standalone service serves administration pages and `/lfclaw/api` on its configured port. Production clients use the configured enterprise service. Automated tests use isolated directories and mock transports, never mutation fixtures against production data.

## Development and validation

<a id="开发与验收"></a>

The development proxy is defined in `admin-web/vite.config.ts`; `VITE_LFCLAW_API_URL` can select the API. The two child READMEs own launch, build and authorization details. Publication and recovery follow the versioned archive procedure.

Executed evidence belongs in the [work log](../07-工作日志/README.md); rendered pages or success notices alone do not establish backend validation.
