# LFClaw Enterprise Service

English | [中文](README.zh.md)

<a id="lfclaw-企业服务"></a>

The repository Host build references server declarations through `tsconfig.build.json`, emitting `lib/types`. That build config uses the repository workspace paths and references its five direct workspace dependencies, so a clean checkout can compile without preexisting package output. The server retains NodeNext module resolution; client compilation excludes server tests.

Employee-owned enterprise OAuth supports desktop loopback callbacks while the enterprise service retains its public HTTP IP. The client authenticates to `oauth-loopback` with a temporary `127.0.0.1` callback, then calls `oauth-complete` under the same identity after browser return. The server validates employee, connector, configuration, single-use state and PKCE before exchanging the code, discovering tools and saving employee credentials. The client stores no enterprise OAuth tokens; tool calls remain server-mediated.

The enterprise service launches as a Cordis plugin through a DSH Web profile, with `/lfclaw/api` as its prefix. The administration development proxy connects to DSH Web. Default data is this directory's Git-ignored `data/`.

## Session sharing and notifications

<a id="会话分享与通知"></a>

Published announcements persist title, body and publication time. Logged-in employees read `GET /api/employee/announcements`. `POST /api/employee/announcements` accepts `{ "id": "announcement ID", "action": "read|unread|delete" }` for personal state and `{ "id": "all", "action": "clear" }` to clear personal announcements. Read/deleted state is per employee, preserving other employees and administration history. Older announcements also appear. The client displays announcements with unread totals; this feature does not send operating-system notifications.

Administrators revoke announcements through `POST /api/admin/notifications/:id/revoke`. The service retains `revokedAt`, history and audit logs. Repeated revocation returns the same record without duplicate logging. Revoked announcements disappear from employee lists and `/api/employee/me`, and further employee state changes are rejected. Polling or manual refresh removes them and recalculates unread counts; reconnecting offline clients receive only active announcements. Older records without `revokedAt` remain active.

`DELETE /api/admin/notifications/:id` removes revoked announcements; active records return 409 and require revocation first. Deletion removes the announcement and administration history but retains a body-free audit record. Repeated deletion returns 404; existing backups remain unchanged.

Employee `/api/employee/session-shares` accepts complete sessions and file bundles. `/employees` lists active names and departments for cross-department search; `/policy` returns current limits. `/notices` reads or updates the employee's read, unread, individual deletion and clear-all states across devices. `/:id/download` permits only designated recipients before expiry. Disabled employees and credentials invalidated by code reset or logout cannot download.

Shares live in `dataDirectory/session-shares`, outside the employee database and without object storage. Version 1 `index.json` stores policies, share metadata and recipient notices; random UUID JSON files store sessions and attachments. Defaults are 30 days and 50MB of chat plus original file bytes, with separate bounded HTTP allowance for base64 expansion. Each download validates length and SHA-256; corruption stops it with an error.

Administrators set retention and size for new shares through `GET/PUT /api/admin/session-sharing`, accepting 1–365 days and 1KB–1GB. Changes preserve existing expiry times. `shareCleanupIntervalMs` controls the plugin-owned timer, default 60000 milliseconds and minimum 1000, stopped on disposal. Startup, notice reads and downloads also clean expired files. Notices independently remain for 30 days; deleting notices does not delete files, and surviving notices identify expired files. Claimed local sessions survive server cleanup.

## Local launch

<a id="本地启动"></a>

Install root dependencies and set `LFCLAW_ADMIN_PASSWORD` to at least 12 characters for initial setup. Use a dedicated `LFCLAW_DATA_DIR`; administration uses `LFCLAW_DSH_URL` to locate DSH Web.

Administrator login and employee activation separately rate-limit failures by source address. `authWindowMs`, `loginMaxFailures` and `activationMaxFailures` in `cordis.patch.yml` define the window and thresholds. Exceeding them returns HTTP 429 and `Retry-After`; success clears that endpoint's counter for the address.

`adminSessionTtlMs` and `employeeSessionTtlMs` define token lifetimes. Session digests survive restarts; older session files receive expiry times at first startup. Expired tokens are rejected and removed from session storage.

```sh
pnpm install
pnpm dsh web --patch ./LFClaw/02-管理端/server/cordis.patch.yml --port 39811 --no-open
```

Run `pnpm dev --host 127.0.0.1 --port 5173` in `LFClaw/02-管理端/admin-web`. The initial account is `admin` with the initial environment password. Subsequent password changes use the administration page and invalidate prior administrator sessions.

## Permission APIs

<a id="权限接口"></a>

### General connector authentication

<a id="通用连接器认证"></a>

Connector `authentication` declares `type` (`none`, `token`, `fields`, `oauth`) and `owner` (`enterprise`, `employee`). Fields declare `key`, `label`, `required`, `secret`, `target`, `name` and `prefix`, mapping to stdio environment or HTTP headers. Independent account APIs store values outside public descriptions. Legacy `employeeCredentials: wechat-mp` maps to AppID/AppSecret while retaining existing bindings. Mall connectors retain their common authentication and business-permission checks.

Administrators use `/api/admin/connectors/:id/credentials`; employees use `/api/employee/connectors/:id/credentials`. GET returns state and a configuration digest; POST accepts `operation` (`save`, `oauth`, `remove`) plus that `configuration`, with `values` for save. The login token determines ownership; clients cannot select another owner. Blank values preserve existing values only for the current configuration; changing nonsecret account fields requires secrets again. Saving verifies connection and discovery, not permission for every remote business operation; failure preserves the prior account.

OAuth uses MCP SDK discovery, dynamic registration, code exchange and PKCE. Providers without dynamic registration can configure public `clientId`, `issuer` and optional `scopes`. Callback state expires after ten minutes and is consumed once; completion rechecks initiator, configuration, assignment and connector enablement. Tokens refresh when required; failed renewal requires authorization again. Disconnect deletes local authorization and rejects late results without undoing remote operations or automatically revoking provider-site consent.

Desktop employee loopback callbacks do not depend on `LFCLAW_OAUTH_CALLBACK_URL`; they require matching clients and provider loopback support. Shared administrator accounts and older clients use a browser-accessible HTTPS `LFCLAW_OAUTH_CALLBACK_URL` routed to `/lfclaw/api/connectors/oauth/callback`. Missing configuration returns `503 OAUTH_CALLBACK_UNAVAILABLE`. The development patch defaults to a local callback for a same-machine browser. `oauthFlowTtlMs` bounds waiting. OAuth supports HTTP transports only; special QR, private-signature and confidential-client flows require adaptation.

Private credentials live in `connectorAccounts`, excluded from administration responses and downloadable backups; operators must protect raw files. Employee stdio `DATA_DIR`, home and common cache directories are isolated by account revision, not by an OS process sandbox. Changing authentication destinations, field mappings or connection settings requires rebinding. This account-directory format requires matching desktop and enterprise service versions.

### Mall floor permissions and immediate invalidation

<a id="商场楼层权限与即时失效"></a>

Enterprise tokens establish employee identity. Each call reads personal mall selections only; empty, missing or invalid settings deny all mall data without department inheritance. The server clears `openId`, `appId` and `appSecret` query arguments and uses ordinary MCP calls, enforcing floor parameters in the gateway. Prompts or arguments cannot increase access. Multi-floor or multi-region queries use the intersection with authorized scope and identify unavailable floors. Invalid parameters, wholly unauthorized scope or unauthorized tools return 403.

For the current `E:/code/lf-mcp-server2` query implementation, partial floor access permits only `getFloorDimensionData`, `getRegionDimensionData` and `getShopDimensionData`. All five permissions allow all enabled assigned tools, including playground and unknown tools, while tool switches and connector authorization still apply. Partial floor and region requests split per floor; shop requests without a floor split across authorized floors, preventing upstream whole-mall totals or unbounded queries. Any subrequest failure withholds all partial results.

Successful JSON from these three queries replaces the `info` permission explanation with the employee's actual scope, avoiding misleading whole-mall descriptions from ordinary upstream identity. Business `data` and failed responses remain unchanged. Connector and floor authorization do not enable tools automatically; administrators must discover and select mall tools.

Discovered non-mall tools are automatically available without individual administrator grants; legacy `allowed` values do not restrict them. Unknown tools remain rejected, and connector, employee and assignment checks still apply. Employee-owned WeChat accounts can save AppID/AppSecret and discover tools without another tool grant. Credentials are employee-specific; runtime directories separate connector, employee and account revision. Disconnect or configuration changes invalidate old calls. Clients must load the account form and Host account endpoints.

`GET /api/employee/connector-catalog` returns connectors, effective floors and a revision digest. The same `revision` waits for changes or `mcpTimeoutMs`. Committed administration changes wake affected clients and abort in-flight discovery and calls; restoring identical permissions does not release old results. Clients remove old tools, discard late results and refresh scope. Failed synchronization clears old authorization before retry, without requiring login again. Notifications depend on single-process `JsonStore`, not multiple writers or direct database editing.

Neither `LFCLAW_MCP_PERMISSION_SECRET` nor Java `lfclaw.permission.secret` is required. The gateway sends no permission-signature header and does not enter Java enterprise-signature identity. Legacy `mcpSecretEnv` is read compatibly but unused. MCP source and configuration need no changes.

Floor restrictions cover calls through LFClaw enterprise services, not MCP access by other clients. Personal connectors cannot bypass the gateway through the configured mall connector's origin. Revocation does not erase historical conversation data; it protects subsequent calls and pending results.

### Resources and administration APIs

<a id="资源与管理接口"></a>

Connectors support Streamable HTTP, legacy SSE and stdio. Remote connections use service URLs and custom headers. Administration masks header values; blank edits preserve them only for unchanged URLs, while changed URLs require new values to avoid forwarding old secrets. Existing mall SSE connections retain gateway-enforced floor limits. Icons accept PNG/JPG up to 2MB; clients use a default glyph when absent.

Stdio stores `command`, string-array `args` and string-map `env`. Commands run on the enterprise server; employees call authorized tools through the gateway. `npx` requires server Node.js and a suitable service PATH; paths such as `DATA_DIR` belong to the server. Every test, discovery or call creates an independent process and closes it after success, failure, timeout or revocation. MCPs needing persistence must use dedicated data directories.

Stdio merges the SDK base environment allowlist with explicit administrator variables, never the whole enterprise environment; stderr is excluded from enterprise logs. Administration blanks `env` values; employee catalogs omit commands, arguments and environment. Audit logs retain field names only. Blank values preserve existing environment only for unchanged command/arguments; removed keys remove variables, and changed commands require new values. Transport changes clear irrelevant fields. The server validates types, names and lengths. Tests discover but do not authorize tools. Put secrets in environment variables, not displayed command arguments.

`showToolsInClient` is a boolean defaulting to `true`. Employee catalogs return authorized connectors and this display flag; desktop cards remain visible but show tool names, counts and descriptions only when true. Legacy `showInClient` supports migration only. The flag changes no employee, connector, tool or mall authorization and does not block authorized agent calls.

Effective employee permissions include `expertKind` (`expert` or `team`) for separate administration displays; both use the same expert authorization set.

Administrators obtain tokens through `POST /api/admin/login`, then send `Authorization: Bearer <token>`. `GET /api/admin/employees/:id/effective` returns effective model, skill, connector and expert decisions with sources. `PUT /api/admin/permissions/:collection/:resourceId/:employeeId` accepts `{"decision":"allow|deny|inherit"}`; inherit removes personal overrides. Disabled resources remain unavailable; personal denial precedes personal allowance, and department grants reach descendants. Every mutation is logged.

Mall data permissions are `operation.floor.1` through `operation.floor.4` and `operation.self_operated`. `GET /api/admin/employees/:id/mcp-permissions` returns effective personal choices without inheritance mode. PUT accepts only `{"permissions":[...]}` with unique valid IDs; empty means none and null returns 400. Department floor fields do not authorize data. Writes validate, persist and audit selections; editing basic employee fields preserves them. Mall calls recheck these values and constrain arguments after connector/tool authorization. MCP source remains unchanged.

Employees activate through `POST /api/employee/activate`. `GET /api/employee/me` returns their currently available resources. Model and mall calls recheck current authorization server-side, so revocation takes effect without another login.

Agent preparation uses `GET /api/employee/model-catalog` for `{ models }` and `GET /api/employee/skill-catalog` for `{ employee: { id }, skills }`. These endpoints recheck employee identity and current resource permissions on every request and return `Cache-Control: private, no-store`. They retain model capacity and skill version/hash metadata while omitting icons, connector data, experts and notifications. The full `/me` response remains available for resource screens and older clients; deploy the service before clients that use the preparation endpoints.

Composer lists use `GET /api/employee/identity` for `{ employee: { id } }`, `expert-picker` for enterprise and owned personal expert labels, and `connector-picker` for connector IDs, names and `hasAvailableTools`. These responses omit icons, expert instructions, tool definitions, credentials and unrelated resources. Each request rechecks current identity and authorization, including enterprise team members and connector account availability, and returns `Cache-Control: private, no-store`; deploy these endpoints before clients that consume them.

Administrators assign enterprise experts to all employees, departments or selected employees. Bailian uses a published App ID, optional Workspace ID and server-held key. Dify Chatbot / Chatflow uses an HTTPS `/v1` base URL, application key and optional input JSON. WeKnora Agent uses an `/api/v1` base URL, Agent ID and workspace key with `chat` access; HTTP is accepted but transmits the key unencrypted, so prefer HTTPS when available. Employee catalogs omit keys. Authorized remote experts prepare through `POST /api/employee/experts/prepare`, then local tools call `POST /api/employee/experts/:id/chat`, reauthorizing every call. Dify verifies application type and uses employee identity, blocking `chat-messages` and returned `conversation_id`; Agent, legacy Agent and Workflow are unsupported. WeKnora creates a session, calls `agent-chat`, gathers only SSE `answer` events and waits for `complete`. Returned conversation IDs are signed for expert and employee, preventing cross-employee continuation. WeKnora shares an overall `expertTimeoutMs`, locally 180 seconds; expiry returns HTTP 504 `EXPERT_TIMEOUT` without an incomplete answer, although remote processing may continue. Other platforms need adapters. Teams require all member authorizations. Personal experts use separate draft and save endpoints: `/api/employee/personal-experts/draft` generates through the employee's authorized default model, and `/api/employee/personal-experts` saves after confirmation. Only the owner can read, edit or delete them; administration data excludes personal experts.

Connector assignments accept all employees, valid departments or valid employees. Models, skills, connectors and experts support `scope: none` with empty `scopeTarget`, denying everyone before personal overrides. Nonempty targets must exist. Server visibility and calls evaluate assignment, overrides and tool enablement. Tool switches define connector-wide availability; employee details separately define five mall data permissions.

One model may be the enterprise default; creating or selecting a default clears other flags. Editing preserves department/employee assignments. Name is for display and upstream model ID for requests; older records without an upstream ID use the name.

Models may configure per-million input/output token prices and a three-letter currency, with both prices required together. Calls retain a pricing snapshot. Valid usage plus complete pricing yields costs rounded to six decimals; otherwise cost is unknown. Monthly overview totals only same-currency, fully priceable records and never treats unknown costs as zero.

`mallDataPermissions` is independent of name, address, transport and custom headers. It defaults off and only one connector per enterprise may enable it. Legacy `authMode: mall` reads as enabled and saves as the explicit switch. Ordinary disabled-switch services use connector/tool permissions; identified DBC MCP Server mall services reject employee calls if the switch is off. Enabled mall mode restricts tools and query scope by employee floors. SSE retains `/sse` or `/sse2`; Streamable HTTP uses its configured URL, both preserving server headers.

Authenticated `POST /api/employee/personal-connectors/check` validates personal remote MCP addresses. Any origin matching an enterprise connector with mall permissions returns 403 and requires enterprise access; invalid addresses return 400. The endpoint accepts no headers or local environment, stores no personal configuration and does not replace remote authentication.

First enabling mall mode or changing its URL, transport, headers, command, arguments or environment performs read-only connection and discovery before saving. Failure preserves prior configuration and returns `MCP_PERMISSION_UNVERIFIED`. Renaming and tool-grant edits skip connection checks. Discovery neither calls business tools nor grants new permissions.

## Data and verification

<a id="数据与验证"></a>

`GET /api/admin/data` calculates `dashboardTrend` and `recentActivities`. Trends cover today and six previous UTC dates, counting accepted employee model requests including success, failure and processing. `conversations` means model calls, not local session count. `tokens` sums known nonnegative integers; `missingTokenCalls` identifies unknown usage. Active employees are distinct by date and ID. Authorization rejections and administrator model tests are excluded; chat bodies are not collected.

`GET /api/admin/usage` aggregates gateway usage on demand. Optional inclusive UTC `from` and `to` dates use `YYYY-MM-DD`; `employeeId` and `modelId` combine as filters. Responses contain employee, model and total request counts, known input/output/total tokens and calls missing any token field. Deleted entities display original IDs. Invalid or reversed dates return 400; unauthorized access returns 401. `/api/admin/data` returns aggregated monthly costs without raw `modelUsage`. Reporting runs outside employee request processing and scans retained server JSON usage as needed.

Latest activity returns at most twenty audit records newest first, covering resource/permission edits, activation-code resets, branding, announcements and manual backups. Historical activity includes only recorded operations. Responses contain time, IDs, type and summary. Invalid persisted records report storage errors while preserving files, never invented empty totals. Statistics are read-only and recomputed after restart.

Mutation summaries retain resource type and name at operation time, remaining readable after deletion. Edit summaries list rename, enablement and changed fields; secrets, authorization headers and endpoint settings log names only, never values. Repeated unchanged saves state no configuration change. Older operation types recover action semantics while missing names/details remain explicitly unrecorded; old logs are not rewritten.

Skill ZIPs require one outermost main `SKILL.md`; nested skill guides may remain inside its directory. Peer main entries or outside files are rejected, and main YAML needs a nonempty description. Upload returns that description; resource saves reread it from the ZIP for administrator and employee use. Administrators supply names. New version is 1; ZIP replacement increments it, while rename/enablement does not. `GET /api/admin/skills/:id/versions` lists history and `POST /api/admin/skills/:id/rollback` selects `{"revision":1}`. Rollback rereads and validates the ZIP, then publishes a higher revision without overwriting history. Older records can establish history only from their current version. Backups include current and historical ZIPs. Employee catalogs return authorized version and SHA-256; `/api/employee/skills/:id/download` serves only the currently enabled authorized revision and supports ETag. Desktop ui-enterprise-skills handles downloads, validation and local caching, rechecking authorization on reads.

Business data lives in `LFCLAW_DATA_DIR/db.json`, defaulting to `data/db.json`; administrator identity is `admin-auth.json`, with backups and skill attachments under `backups/` and `skills/`. Mutations and announcements return success only after server persistence. Refresh and restart reread files; closing browsers may require login but does not erase data. Changing `LFCLAW_DATA_DIR` selects another dataset; the version-publication UI remains unavailable. Downloaded backups include model usage and referenced skill attachments but exclude personal experts, including revalidated historical archives. Restore preserves current personal experts and ignores archived personal entries. Server migration must separately protect and migrate raw `db.json` to preserve personal configuration. Restore validates data and archive, creates a safety backup and retains only that backup in the restored list, avoiding records without ZIPs. Never commit these files. Run `pnpm --filter @deepseek-ai/lfclaw-admin-server run test` and `pnpm --filter @deepseek-ai/lfclaw-admin-server run typecheck` for server checks.

`DELETE /api/admin/backups/:id` temporarily moves the archive, removes its record and then deletes the file. Failure attempts to restore both and reports failure. Old records with missing files can still be deleted. Deleted backups cannot be downloaded or restored; the operation is audited.

Desktop `POST /api/employee/v1/chat/completions` uses OpenAI-compatible enterprise models. Request `model` is an enterprise resource ID; the server resolves upstream identity/key and rechecks authorization on every call. Tools, call messages and usage are supported. `stream=true` forwards upstream SSE text, reasoning and tool-argument chunks and records final usage; missing completion or upstream errors report failure. `modelTimeoutMs`, currently 120 seconds, bounds full nonstream responses and streaming data waits. Timeout returns MODEL_TIMEOUT; employee cancellation or disconnect aborts upstream work. Legacy `/api/employee/chat/completions` still accepts `modelId`.

Skill publication and desktop installation share ZIP validation, rejecting invalid names, empty bodies, invalid invocation flags, ambiguous entries, unsafe paths and duplicates. Default limits are 32MiB compressed, 64MiB expanded and 20,000 entries. Administration supports uploading, replacing and removing PNG/JPG icons up to 2MiB and editing publication versions.

POST /api/employee/personal-skills/report accepts the current device's complete personal metadata snapshot, limited to name, description, version, personal source and enablement while matching authenticated employee identity. Definitions, scripts, attachments and local paths are excluded. GET /api/admin/personal-skills exposes a read-only employee/device/update-time inventory unavailable to employee tokens. Offline or failed reporting may leave stale metadata; the UI shows report time. Older databases initialize missing personalSkillReports to empty without rewriting personal definitions.

The administration development proxy defaults to `http://127.0.0.1:39811` and supports LFCLAW_DSH_URL. Network and credential errors display separately; login is disabled while pending.

Public `GET /branding` returns slogans, labels and visibility without employee information or credentials. Administrators use `GET/PUT /admin/branding`. Slogans require 1–40 characters, labels at most 12, both single-line, with nonempty visible labels. The database branding field participates in backups. Older records use the default Chinese slogan and preview label. Invalid configuration fails reads or saves; changes are audited.

## Expert center

<a id="专家中心"></a>

Enterprise experts declare `skillIds`, `connectorIds` and `quickPrompts`. Saves validate unique existing dependencies and at most three examples of 300 characters each. Personal experts accept the same fields plus `kind: team` and `memberIds`; records without kind remain single experts. These JSON fields do not change DSH Session formats.

`POST /api/employee/experts/prepare` accepts `owner: enterprise | personal` and `id` under employee authentication. It rechecks ownership, member authorization and all skill/connector dependencies, returning credential-free names, instructions, members and dependencies. Failure returns HTTP 409 `EXPERT_NOT_READY`; administrator tokens are rejected. Personal teams reference owned single experts and enterprise teams reference enterprise single experts. Supported external experts return remote-call identifiers rather than executing their instructions locally.

Preparation only reads current configuration; it executes no task, stores no chat body and grants no access. The client checks local resources and prepares an unsent ordinary draft. Bailian and Dify drafts instruct the model to call enterprise-expert tools for real answers; teams require actual subagent delegation. Later tool and model calls still enforce revocation; prepared drafts do not preserve old permissions.

Models configure positive safe-integer `contextWindow` and `maxTokens`, with output no larger than context. Older models retain 32768 / 8192 until administrators set actual capacity. Employee catalogs return it; the gateway uses model maxTokens as default and ceiling, accepting lower requests and rejecting invalid ones with 400. Thinking may retain provider defaults or explicitly set `enable_thinking` on supported OpenAI-compatible models; the server sends it only when configured. Unsupported providers should keep defaults.

Personal expert editing reads full configuration and revision from "GET /api/employee/personal-experts/:id". Updates may include "expectedRevision"; stale revisions return HTTP 409 "EXPERT_CHANGED" and preserve newer data. The employee management skill always submits revisions when editing. Members must be owned single experts and dependencies currently authorized.

`POST /api/admin/experts/import` accepts `definition`, `preview`, `scope`, `scopeTarget`, `enabled` and optional `targetId`. Preview validates without writes; publication atomically saves the root and new members. Original source can be omitted or `original`, with legacy source IDs retained compatibly. WorkBuddy 1.0 single-expert JSON imports extract `manifest` and `agent.content` and return migration guidance. Local paths, skill files and binary resources are neither saved nor authorized and require separate skill migration. Embedded member IDs are remapped; root updates retain targetId without deleting old members. Dependencies must exist and publication grants no extra employee access. Teams support original members only. Invalid members, nested teams, external API source parameters and invalid scopes fail without partial records.

`POST /api/employee/personal-expert-teams` atomically creates an owned team. Requests contain full `team` and `newMembers: [{key, definition}]`; ordered `team.memberIds` reference existing owned singles or `new:key`. New keys must be unique and referenced. Members, instructions and live capability authorization validate within one storage update before saving together; failure leaves no partial members. Existing members remain unchanged; new members/team receive server IDs. The response `{team, members}` includes only new members. Unknown network outcomes require checking the personal list before another creation attempt. This endpoint creates only; edits retain revision-checked personal APIs.

`modelTimeoutMs` bounds complete nonstream responses, or the first SSE chunk and gaps between subsequent chunks. Receiving data resets the timer instead of ending active output at a total-duration limit. Completion and failure clear timers; client cancellation still aborts upstream work.

Skill uploads and historical reads use `skillArchiveLimits`: 32MiB compressed, 64MiB expanded and 20,000 ZIP entries by default, explicitly set in both server deployments. Desktop `maxArchiveBytes`, `maxUnpackedBytes` and `maxFiles` match. Oversized uploads are rejected without saving a package.
