---
description: "Activate the desktop with an employee code and call enterprise models under current authorization."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activation

English | [中文](README.zh.md)

## Summary

Employees activate the desktop with a code, view authorized models and send requests through the enterprise gateway. Employee tokens stay in the Host; provider keys stay on the server. Catalogs and calls check current permissions. Offline failures retain credentials for retry. Output limits can trigger bounded automatic continuation.

## Table of Contents

- [Use and authorization](#use-and-authorization)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-and-authorization"></a>
## Use and authorization

The Host retains current-employee memory snapshots for `employee/me` and connector catalogs, updating them from background responses. Only display calls explicitly using `catalogMaxAgeMs` may reuse recent responses; default requests, permission checks and tool execution contact the enterprise service. Account changes, logout, failed synchronization and connector account edits clear related snapshots. Expired snapshots are refetched; late older responses cannot replace newer results.

The desktop profile connects with an employee activation code. The Host saves the service address and token in credentials storage; the renderer receives only verification status and the employee name. Opening a workspace checks the employee endpoint again; expired or offline authorization blocks entry. Offline failures retain local credentials for retry after service recovery.

`serverUrl` is the enterprise API root including `/lfclaw/api`; `timeoutMs` bounds requests. The desktop defaults to `http://8.216.38.213:39811/lfclaw/api`, also used for local operation and manual integration. `allowInsecureHttp` defaults to false; the shipped HTTP deployment explicitly enables it but still rejects URLs containing credentials, query parameters or fragments. `LFCLAW_SERVER_URL` supports user-requested address changes. Switching servers requires reactivation, never sends the old token to the new address, and neither migrates nor deletes local chats.

The desktop catalog exposes employee-authorized OpenAI-compatible text models and uses the server default unless the existing personal selection remains valid. Every model call rechecks authorization; background catalog refresh runs every `refreshIntervalMs`. Provider keys stay on the server; the Host uses an employee token for the gateway. Separate client plugins supply enterprise skills, connectors and experts.

A lost enterprise connection reports a retryable `TRANSPORT` model error and asks the user to check files already written in the workspace. Failure does not automatically delete existing files.

The activation page uses a white welcome view, LFClaw text branding and orbital decoration. Small windows scroll internally while keeping inputs accessible. Decoration carries no interaction; keyboard focus stays inside the activation dialog. English and Chinese dictionaries supply fields and messages.

After successful activation, the sidebar footer shows employee and department names; a collapsed sidebar shows an initial avatar. The employee endpoint supplies display information; activation codes and tokens never enter the employee component. Missing departments display the localized unassigned-department label.

The sidebar employee menu offers logout and reactivation. Confirmation clears local employee credentials, reloads the client and returns to activation for the same or another employee. Local chats and files remain and are not partitioned by employee. Logout does not revoke other devices or wait for running tasks; later enterprise requests may fail without credentials. Failed or unconfirmed logout keeps the dialog open with retry or reopen guidance.

Model adaptation uses PiAiAdapter. The authorized catalog supplies each model's `contextWindow` and `maxTokens`; edits apply on catalog refresh and the next request preparation. Desktop values support older servers without capacity fields. Invalid capacity clears the catalog and reports an error. The gateway forwards upstream SSE text, reasoning and tool-call chunks, recording usage on completion; ordinary JSON responses are converted to SSE. Employee disablement, model revocation or activation-code reset blocks subsequent calls.

Enterprise models retain tool definitions, context and results required by skills, commands and connectors. The application adds no LFClaw assistant identity or prescribed self-reported model name; request records and upstream responses identify the actual model.

Deployment explicitly sets `modelMaxRetries`, currently 1 in the desktop. `timeoutMs` is currently 150 seconds, exceeding the enterprise gateway's 120-second `modelTimeoutMs`. Upstream timeouts and interrupted streams report failure rather than complete output.

The activation page uses the transparent gold brand icon at `./assets/lfclaw-logo.svg`.

Local `GET /api/lfclaw/branding` reads public homepage copy from the configured enterprise service. It returns only slogans, labels and visibility flags, without an employee token. Requests use `timeoutMs` and reject redirects; failure returns a non-success status and the welcome page offers retry.

Homepage copy registers at `conversation.hero.brand.text` and reads local `/api/lfclaw/branding`. Mount and window focus refresh it; failures retain prior copy with a retry entry, and initial loading uses the dictionary default. Administrators maintain this display-only configuration; it never enters model requests. Registration belongs to activation and does not depend on the expert-page plugin.

When enterprise output reaches its limit, the Host queues a notice continuation in the same Session, retaining prior text and successful tool results. Each human request permits `maxAutoContinuations` continuations (deployment value 3; 0 disables them). After `maxNoProgressContinuations` consecutive empty or identical outputs without successful tool results (deployment value 2), an error explains the stop. API failures use `modelMaxRetries` and do not trigger output continuation. Queued user messages take priority; cancellation and plugin disposal remove pending automatic notices. Attempts persist with notices and remain bounded after recovery; merely opening history never starts a model call. Reworded unproductive output may evade detection, but the total attempt limit still applies.

The composition enables compaction-basic at 80% context usage, reserves output capacity plus 4096 tokens, retains recent messages within roughly 16% of the available message budget and caps summaries at 4096 tokens. Summaries retain the user goal, facts, files, current work, remaining tasks and next steps; raw session logs remain intact. Summary generation and over-context recovery each retry at most once before reporting persistent failure.

Before sending, enterprise requests estimate messages, system instructions and tool definitions against the latest authorized capacity while reserving output tokens. Exceeding capacity reports a context error for the existing compaction recovery. If compaction cannot fit the budget, the request stops without knowingly sending over-budget input or triggering output continuation. This estimate is not the provider's exact tokenization.

<a id="model-experience"></a>
## Model Experience

### Automatic output continuation

#### What the model sees

Automatic continuation instructions enter model context and the session log. The notice asks the model to resume without repeating earlier text or completed tool operations. `lfclaw-output-continuation` identifies the persisted notice; history compaction retains the task summary and recent messages.

#### Token effect

Each continuation adds a notice and subsequent output. Successful tool results remain in history; the composition's compaction-basic owns compression while preserving raw logs.

#### KV Cache effect

Continuation appends messages without rewriting completed output. Compaction replaces the request's historical representation; cache reuse depends on the first changed position.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Automatic continuation cannot guarantee task completion or recognize every paraphrased repetition; the attempt limit still applies. Compaction does not preserve verbatim memory of all dialogue. Real model calls, deployed operation and installer delivery require separate validation.

<a id="dev-note"></a>
### Dev Note

Automatic continuation uses existing Agent events and the durable inbox; bounded adapter retries handle API errors. See the [continuation source record](../../../docs/persistence-changes/2026-10-16-lfclaw-output-continuation.md) for persistence compatibility.
