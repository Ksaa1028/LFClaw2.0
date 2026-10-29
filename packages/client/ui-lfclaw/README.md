---
description: "Create, edit and use personal experts and expert teams through chat, combining authorized enterprise skills and connectors."
kind: "package-reference"
---

# LFClaw Employee Expert Assistant

English | [中文](README.zh.md)

## Summary

Employees browse Enterprise Experts, My Experts and My Expert Teams. Creation and editing open a conversation with the expert-management skill, where employees refine requirements and save configuration. Using an expert checks live authorization and local dependencies before preparing the task. Only the owner can read and edit personal configuration.

Composer experts and teams use the lightweight `employee/expert-picker` list. Selection appends a reference locally, preserving draft order, without requesting full configuration. Sending resolves current authorized instructions and dependencies; revoked access prevents submission.

## Table of Contents

- [Usage](#usage)
- [Workflows](#workflows)
- [Session sharing](#session-sharing)
- [Implementation and failures](#implementation-and-failures)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="usage"></a>
## Usage

Expert pages load `employee/expert-catalog`, retaining complete expert instructions, prompts and team membership while fetching only IDs and names for related skills and connectors. Unrelated icons, model configuration and notifications are excluded. Detail views need no second fetch, and starting an expert still validates current permissions and dependencies.

Expert pages and composer expert/team pickers reuse the current employee's Host catalog snapshot. `expertCatalogMaxAgeMs` bounds display reuse, defaulting to 30000 milliseconds; 0 disables reuse. Manual refresh, preparation and execution always request current server state. Personal expert/team creation, modification and deletion invalidate prior catalogs. Account switches, logout and failed synchronization follow enterprise connection snapshot cleanup.

Expert pages keep their heading, tabs and search visible while cards scroll. Notifications keep their heading and tabs visible; announcements and shared conversations each use ten entries per page with fixed pagination controls. Switching message tabs returns to the first page.

LFClaw sidebar names, icons and conversation branding use priority `-1` to override default branding at priority `0`. Both contributions can remain loaded; unloading LFClaw restores the default. The LFClaw dictionary supplies the sidebar name, so replacing only the icon must not retain default text branding.

The desktop composition mounts this plugin; the enterprise Web preview overlay also enables activation, skills, connectors and expert assistance. Host dependencies are `connection`, `enterpriseConnection`, `skills` and `tools`; Client dependencies are `slots`, `locale`, `layout` and `uiWorkspace`. Host `sharedSessionDirectory` stores claimed shared outputs persistently, defaulting to `.lfclaw/shared-sessions` under the user home; the desktop uses `lfclaw/shared-sessions` under its DSH home. Client `shareRefreshIntervalMs` defaults to 30000 milliseconds with a 1000-millisecond minimum.

<a id="workflows"></a>
## Workflows

The employee entry and panel are currently hidden. Implementation and existing server records are retained.

Start with a conversation: AI drafts a title, requirements, acceptance criteria and handoff summary, resolves explicitly named employees, and asks for missing details. Review the proposed work before confirming assignment. Detailed fields remain editable; completion copies support name search, department filtering and checkboxes. Returning to the list retains the unsent draft while this panel remains mounted; successful creation opens Started by me. Subsequent operations can generate a missing handoff summary automatically from the handling notes.

The Workflows sidebar entry supports work within and across departments: confirm requirements, assign one handler, request clarification, transfer, submit, return for changes, approve and copy the final result. The creator selects the reviewer and completion-copy recipients. Requirement changes retain snapshots and require the handler to accept before processing continues. Cancellation by the creator preserves the record.

Every operation requires original notes and a handoff summary. AI organizes the supplied text and lists missing requirements; it does not inspect uploaded files or approve work. Employees confirm suggestions or write summaries manually. Submitted files are immutable per operation; HTTP/HTTPS links remain externally owned and their contents can change. Final copies expose only the last submission and approval, while participants can read all history.

The enterprise service persists records, checks current identity and node ownership, and rejects stale revisions. Exact retries use an operation ID; changing a previously submitted request requires reviewing the saved record first. Failed requests preserve input. The list refreshes using shareRefreshIntervalMs while open. The server workflowRequestMaxBytes setting limits the complete JSON request including Base64 files, defaulting to 4194304 bytes; large files should use shared links.

This MVP uses sequential handlers and manual assignment. It has no parallel approvals, configurable process designer or automatic escalation. Administrators can list metadata only and cannot process work. Workflow content is excluded from downloadable administrator backups; operator filesystem backups must preserve the full database.

<a id="session-sharing"></a>
## Session sharing

Notifications separate enterprise announcements from colleague shares, showing the selected category and its unread count; the sidebar badge totals both. Cards omit redundant category labels, while colleague shares retain sender names. Unread cards use light styling and an unread label; read cards show a read label. Only unread messages offer marking as read. Announcements cannot be deleted or cleared by employees; colleague shares support individually confirmed deletion without affecting claimed local sessions. Published announcements show title, body and time; the enterprise service stores per-employee state. Withdrawn announcements disappear on the next inbox poll or refresh, updating unread counts. The desktop must load the corresponding Host and Client plugins; server updates alone do not add the feature to older binaries.

Share session in the history menu searches active employees across the enterprise and supports multiple departments. It sends complete session logs, durable attachments and AI output files declared by `deliverables/presented`; missing files, read failures and exceeded limits reject sending. The Host retains employee credentials. After server copies are saved, recipients see source, title, time and expiry in colleague shares; online refresh updates unread counts.

Claiming a share copies attachments and outputs, relocates historical output paths and creates an independent inherited local session with the recipient's default Agent preset and model. Its parent Session ID identifies the source so inherited delivery receipts remain readable. The original remains unchanged; DSH inheritance separates original history from new recipient content. Repeated claims return the same local session. Claimed files do not depend on continued server share availability. Later connector calls use the recipient's enterprise identity and current authorization.

Deleting or clearing messages changes only recipient notifications, not shared files or local sessions. Download failures retain messages. A network interruption during sending may leave an unknown outcome; recipients must check before retrying. Storage failures during claiming may leave unreferenced persistent attachments and outputs; user directories are not automatically erased. Shared presets, tool code and enterprise credentials are not installed in the recipient environment.

The sidebar and page use the Expert Assistant title and reuse skill-management layout, search, cards and detail dialogs. My Experts offers creation; My Expert Teams offers team creation. Edit in chat opens the management skill with the owned resource ID. Employees have no creation or editing form. Refresh reads currently visible resources again.

Expert management turns natural-language requirements and source material into roles, methods, output rules and dependencies, then saves through tools. Editing first reads the current revision and refuses conflicting writes. Administrators maintain enterprise experts; personal management tools cannot publish enterprise resources.

<a id="implementation-and-failures"></a>
## Implementation and failures

Expert assistance reuses the Host's persistent employee login; the browser holds no enterprise token. Local `/api/lfclaw/expert-center` reads catalogs, `expert-prepare` prepares task definitions and `personal-experts` deletes owned resources. Conversational tools use the Host enterprise transport to read and save personal configuration. Personal configuration synchronizes to the enterprise service but is excluded from administrator lists and enterprise backups.

Saving verifies member ownership, rejects teams as members and checks current skill and connector access. Starting rechecks the expert, members and every dependency, followed by local skill readiness and authorized connector tools. Any failure retains the original task and reports the error; actual tools still reauthorize. Unknown save outcomes after network failure require reading the list before another creation attempt.

Existing configurations without extended fields read as single experts. Deleting a member prevents dependent personal teams from preparing tasks until reconfigured. Viewing or opening creation does not send model requests; user submission uses the normal session log and skill injection.

See the [enterprise service](../../../LFClaw/02-管理端/server/README.md) for APIs and [expert management resources](../../../LFClaw/09-资源/技能/专家管理/README.md) for the WorkBuddy reference archive and adapted resources.

<a id="model-experience"></a>
## Model Experience

### Expert management skills and tools

#### What the model sees

Explicit skill references load `lfclaw-expert-manager`. `list_expert_resources` returns owned experts and authorized enterprise capabilities; `read_personal_expert` returns configuration and revision; `save_personal_expert` creates or modifies an expert; `create_personal_expert_team` creates a team and missing members together. Members need not preexist: read complete existing configurations before reuse and design missing members in the same conversation. The server validates and saves the group atomically; failure leaves no partial new members and does not modify reused ones. Tool schemas specify field limits; results retain actual IDs and names. Failures use standard tool results; a written promise is not a successful save.

#### Token effect

Skill text enters the session only after loading. The four tools' parameter descriptions enter requests with visible tools. Full configurations, catalogs and subsequent results consume context according to expert count and instruction length.

#### KV Cache effect

Loaded skills and results remain ordinary session history. Editing configuration does not rewrite previous messages; reading it again appends new results. No additional hidden system instruction is updated.

### Expert tasks and team delegation

#### What the model sees

Prepared drafts contain a concise expert reference and task. At send time, serialization reads current authorized configuration, checks local dependencies and includes full instructions, member configuration and skill invocation text. A single expert follows its instructions; a team asks its lead to dispatch independent work through actual `subagent` calls, retain real IDs, await real results and summarize. Independent constraint review may run alongside design; review requiring a draft waits for it, while the lead handles formatting and synthesis. Members report once in final answers; the lead avoids repeated status queries or sleep commands and delivers once after all results. Final output prioritizes the user request, compresses internal process and reserves room under word limits. Undispatched members must be identified; missing tools stop execution rather than simulate members. Scheduling instructions require checking work hours, time slots, deadlines and dependencies without inventing shorter durations or delays, and prohibit repeatedly creating temporary files merely to count words.

#### Token effect

Task configuration enters as user input; member count and instruction length determine input cost. Independent subagent requests and returned results consume their own tokens; team presentation does not provide free reuse.

#### KV Cache effect

Expert configuration is read and recorded at send time; edits while a draft is open affect its later send. Subagents have separate histories. Their results append to the lead's session, with no guaranteed cross-member cache sharing.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Subagent tools come from the selected preset; execution depends on models and member configuration. Team instructions request constraint checks and real results but cannot guarantee correct output or completion within a fixed duration.
- Authorized Bailian, Dify Chatbot / Chatflow and WeKnora Agent experts enter ordinary conversations from details or the Expert picker. Sending first checks that the local remote-expert tool is loaded; otherwise it stops with restart guidance. The model must then call `call_enterprise_expert`; the Host forwards it using employee identity and logs the response as a tool result. Other platforms without server conversation adapters expose only catalogs and setup guidance. Teams containing external service members are unsupported.
- Expert dependencies currently include enterprise skills and connectors only. Personal capability dependencies, complete expert ZIP import/export, avatar generation and version rollback are not integrated.
- The original WorkBuddy archive is retained as reference; its directory-writing and registration scripts are not executed. The adapted ZIP supplies a management skill that depends on this plugin's tools and cannot manage experts independently.

Personal expert responses may include `source: personal`. Details identify remote experts using enterprise ownership plus an explicit external source. Personal experts and personal teams provide local task entries.

Personal cards show names, descriptions and details without duplicate ownership or type labels; icons and filters still identify types. Enterprise cards show their source: original, Aliyun Bailian, Dify, WeKnora or another platform. Details omit permanent generic permission guidance; actual failures still report specific causes.

Expert entries prepare concise references. Expanded send-time configuration starts with the selected expert or team name and includes complete configuration, which remains inspectable in sent messages. Instructions ask replies to begin with the name, but names do not replace actual delegation records; member participation is established by subagent calls and results. Pasting a task into ordinary chat does not select an expert automatically.

The composer Add menu has Expert and Expert Team pickers, grouped by enterprise and personal ownership. Search covers authorized original enterprise resources, integrated Bailian, Dify and WeKnora experts, and personal resources; other external sources need a conversation adapter. Selection rechecks authorization and local dependencies, then adds a concise reference to the current draft while retaining its task, references and attachments. It neither sends nor creates a session. Draft edits or session disposal during loading prevent overwrites and request reselection.

Sent expert references collapse to their names; clicking expands the complete working configuration. Named structured text remains in the message record so model input and replay are reconstructable; only display changes. Older messages without structural markers are not folded by keyword guessing, and invalid markers display unchanged.

Expert teams distinguish persistent teammates from temporary subagents. Persistent communication uses targets returned by `spawn_teammate`; temporary session IDs returned by `subagent` are not team `send_message` addresses and cannot be queried through team `list_agents`. Temporary results arrive through system delivery. Member failures report their stage and stop automatic repeated dispatch.

Expert references follow the user task while retaining user text and earlier reference positions, so conversation titles use task content rather than internal configuration. Sending still reads full configuration; required skill invocation IDs remain separate text for the existing loader, not JSON-escaped strings.

<a id="dev-note"></a>
### Dev Note

Expert tasks use existing session, skill and subagent mechanisms; the enterprise service owns live resource authorization.
