# LFClaw Administration Web

English | [中文](README.zh.md)


The workflow navigation entry is currently hidden; existing workflow data is retained.

## Workflows

The Workflows page lists workflow metadata only, with search across titles, employees and departments, status filtering and creation-date filtering. It shows creator, current handler, deadline, last update and overdue state. Administrators cannot read original notes or attachments, assign handlers, approve, return, cancel or modify work. Refresh failures are visible and retain the previously loaded rows.

<a id="lfclaw-管理-web"></a>

Model Usage loads enterprise gateway records on demand, filtered by UTC date, employee and model. Account and model summaries show request count, input/output/total tokens and missing-usage counts, with ten rows per page. Deleted employees or models currently retain their IDs in historical summaries. Personal plugins calling outside models directly are excluded. Monthly overview costs come from server aggregation; initial administration data no longer carries individual usage records.

Activation-code copying supports public HTTP pages. It tries the browser clipboard first, then selected-text copying when unavailable or denied. Only confirmed success shows the copied notice; failure retains the code and asks for manual selection. Run the regression from the root with `pnpm exec tsx --test LFClaw/02-管理端/admin-web/tests/clipboard.test.ts`.

Connector authentication supports none, API Key / Token, custom credential fields and remote OAuth. Administrators choose shared enterprise or employee-owned accounts. Shared accounts connect from the list; employees fill fields or open browser authorization in details. Fields map to remote headers or stdio environment variables without returning secrets. See [server authentication](../server/README.md#通用连接器认证) for OAuth configuration, callbacks and supported flows.

Tables, skill and expert cards, notification history and overview activity use ten entries per page with previous, next and totals. Expert filtering resets to page one; deletion clamps page numbers to the valid range. Pagination covers loaded data only; the server still supplies the latest twenty activity records.

Employee details directly select five mall data permissions; an empty selection denies all. Switching employees clears the old form, and late save responses cannot overwrite the new employee. See [mall permissions](../server/README.md#商场楼层权限与即时失效) for invalidation and upstream restrictions. Run component regression from the root with `pnpm exec vitest run --config LFClaw/02-管理端/admin-web/vitest.config.ts`.

Connector forms select Streamable HTTP, legacy SSE or stdio. Remote modes take a service address and headers; stdio takes a command, JSON argument array and JSON environment object, for example `npx` with `["-y","@xihe-lab/wechat-mp-mcp-server@latest"]`. Commands run on the enterprise server, which must have required programs installed; data directories must also be server paths. Mall permissions and PNG/JPG icons apply to all three modes.

Header and environment values stay on the server and read back as blank. An unchanged address allows blank headers to retain values. With unchanged command and arguments, blank environment strings retain values and removed keys delete them; changing command or arguments requires new values. Arguments must be strings and environment entries must map names to strings. Invalid input retains the form with an error. After saving, Test discovers tools for selection during editing. See [server connector guidance](../server/README.md#资源与管理接口) for execution and permissions.

Connector forms expose client tool visibility. Disabling it keeps the desktop card but hides tool names, counts and descriptions; authorized tools remain callable by agents. Enablement and assignment scope apply independently.

Login, sidebar and browser icons share `public/lfclaw-logo-transparent.png`; the source is `../../04-UI设计/brand/lfclaw-logo-transparent.png`.

Administration Web serves enterprise administrators; employees use a separate application. Pages read and write the DSH enterprise service through `/lfclaw/api`, not browser memory or prototype data.

Model thinking mode can retain the provider default or explicitly enable/disable `enable_thinking` on supported models. Disabling may reduce waiting for simple file tasks; unsupported models retain defaults. Saved settings affect subsequent requests only.

Notification history supports confirmed withdrawal of published announcements. Withdrawn entries retain title, publication time, withdrawal time and status; employee inbox refresh removes them and their unread counts. Withdrawn announcements can then be deleted after another confirmation, removing administration history and server records. Active announcements have no delete button.

Overview trends and activity come from administration APIs. Trends cover seven UTC calendar days of employee model calls, known tokens in thousands and distinct daily employees. Requests include successful, failed and processing states; missing token usage is identified separately. Hover shows exact chart values. Latest activity shows twenty persisted administrator operations, with browser-local timestamps. Opening Overview or Refresh reloads data; failures offer retry and empty results show an empty state. See [data semantics](../server/README.md#数据与验证) for historical coverage.

Activity labels classify skills, models, employees and authorization changes, identifying targets and changed fields. Deleted records retain the name at operation time; missing names or change details in older records are explicitly identified as unrecorded.

The server handles department, employee, model, skill, connector and expert mutations, announcement publication and manual backups. Failed saves show errors without retaining failed new rows. Refresh reloads authoritative data. Closing the browser may require login again, but saved data stays server-side. Version publication is not integrated into this page; its entry is disabled.

New enterprise skills require a name and ZIP. The server extracts the description from SKILL.md YAML and exposes it to employees. Editing can replace ZIPs, names or enablement; replacing the ZIP automatically increments the version.

Skill cards offer saved version history and confirmed rollback. Rollback publishes a new revision visible after administrator refresh and through employee resource APIs. Earlier ZIPs remain for history and backups.

Model and skill forms assign all employees, departments or specific employees. All four resource kinds support no assignment, denying every employee including prior personal grants. Department assignments include descendants. Lists show current scope; the server calculates employee visibility from live authorization.

Connector forms also assign all employees, departments or employees. Test performs read-only discovery, then editing selects allowed tools; undiscovered tools show guidance. Tests do not call business data or require a shared signing key. Employee details list currently authorized models, skills, connectors and experts without authorization-source or personal-override controls. Resource modules own assignment; existing server permission records remain valid. Employee tool listing and calls recheck connector access and tool enablement.

The expert center shows enterprise single experts. Administrators configure and test published Bailian applications, Dify Chatbot / Chatflow or WeKnora Agent, or import original single experts with assignment scopes. The page neither displays nor imports enterprise teams, but preserves existing records. Employee-created personal experts belong to the employee client and are neither created nor displayed here.

Employee details group authorized models, skills, connectors, experts and teams with counts and empty states. Teams appear only when both the team and every member are effectively authorized.

Connector forms have an independent mall-data permission switch, disabled by default. Enabled entries show a floor-permission marker; only one connector may enable it, with other entries requesting that the existing binding be disabled first. The switch is independent of name, SSE / Streamable HTTP and headers. Enabling it or changing connection settings verifies MCP connectivity and tools before saving; failure retains the form and original configuration.

Employee details name the mall-permission connector and allow floors one through four plus self-operated retail. Clearing all choices denies mall data, alongside connector and tool authorization. Turning off connector mall permissions restores ordinary MCP behavior while retaining employee selections.

Department forms maintain names and parent departments; employee details separately maintain mall data permissions.

Backup lists support download, restore and confirmed deletion. Successful deletion reloads the server list and removes both the archive and record, preventing later restoration from that backup.

Creation, editing and confirmation dialogs stay within the window. Long forms scroll only their content, retaining title and footer actions. Model endpoint and key fields do not reuse browser autofill from administrator login.

Development preview uses `pnpm --filter @deepseek-ai/lfclaw-admin-web run dev`; type checking uses `pnpm --filter @deepseek-ai/lfclaw-admin-web run typecheck`. The enterprise service selects business data through `LFCLAW_DATA_DIR`; see [server guidance](../server/README.md).

System Status homepage copy edits employee slogans, labels and visibility with a text preview. Failed saves retain drafts; failed loading offers retry. Copy is public branding and refreshes when employees reopen the homepage or refocus the window.

Import original expert accepts uploaded or pasted JSON, validates it and shows a read-only preview instead of individual name, description and instruction inputs. The page provides examples; assignment and enablement remain separate. Editing preserves the original ID and requires revalidation after parameter or publication changes.

The enterprise service performs Validate and preview. Proxy HTTP 502/503/504 responses ask users to inspect the service and retry; they do not indicate invalid example or imported JSON.

The backend retains older team data and import protocols for existing records, while the administration center omits that entry. External experts use a separate setup path; callable sources are Bailian applications, Dify Chatbot / Chatflow and WeKnora Agent. Dify requires an application API base URL, key and optional input-variable JSON; Agent, legacy Agent and Workflow are outside this blocking conversation API. WeKnora requires an API base URL, Agent ID and workspace key with `chat` access. Forms accept provider HTTP or HTTPS without extra confirmation; HTTP sends the workspace key unencrypted. Tests create a real conversation and call the Agent, reporting success only on normal completion.

External expert setup contains identity, source, platform connection parameters, assignment and enablement only. External platforms manage skills, connectors and examples; the local form omits them and saving clears prior local capability declarations. Original experts still declare capabilities through imported parameters.

Department forms maintain only name and parent. Employee details directly select floors one through four and self-operated retail without department inheritance. Empty selection denies all mall data; department transfers do not change personal permissions.
