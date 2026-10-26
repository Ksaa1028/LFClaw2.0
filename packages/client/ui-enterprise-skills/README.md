---
description: "LFClaw enterprise and personal skill management for the employee desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-enterprise-skills

English | [中文](README.zh.md)

## Summary

Employees can use authorized enterprise skills and manage personal skills through ZIP import, confirmed chat creation and editing, and removal. Enterprise packages are cached separately. Administrators receive only personal skill metadata; definitions and attachments stay local.

The composer skill picker appends the selection to the current conversation, preserving draft text, references and attachments without submitting. The management page’s Use action starts a new conversation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The management page reuses the full employee directory for up to `refreshIntervalMs`. Composer and expert skill-resolution requests (`wait=1`) use the lightweight skill catalog without icons or unrelated resources, waiting only for enterprise packages. Loading a skill checks current server authorization.

The page keeps its heading, tabs and search visible while skill cards scroll within the remaining space.

The composer menu hides manual `/compact`; automatic context compaction remains enabled by the session preset. Typing `/compact` directly remains available.

The shipped desktop composition mounts this plugin over `connection`, `enterpriseConnection`, `skills` and `tools`. Configure `dataDirectory`, `maxArchiveBytes`, `maxUnpackedBytes`, `maxFiles` and `refreshIntervalMs` explicitly. The shipped limits are 32 MiB compressed, 64 MiB expanded, 20,000 entries and a 30-second catalog interval.

Cards keep a fixed height and a two-line summary. Details scroll within the dialog. Enterprise icons use administrator-uploaded PNG/JPG images, falling back to the default glyph when missing or unreadable. Edit in chat opens a new conversation for the selected personal skill; its details also offer removal.

<a id="understand-the-implementation"></a>
## Understand the implementation

The independent `./archive` export validates ZIP structure, safe paths, metadata and invocation flags without starting a plugin. The enterprise server imports the same implementation. The unique outermost SKILL.md defines the main skill; nested skill guides and relative resources are retained within its directory. Archives with peer main entries or files outside the main directory are rejected. Wrapper directories are supported. Imports never execute scripts.

Enterprise downloads verify SHA-256 and cache by employee, resource and digest. Actual reads recheck authorization. New and rolled-back digests select their own directories, preserving resources already used by running tasks. Package preparation does not block the initial directory response.

Skill providers, personal skill operations and background preparation read `employee/skill-catalog` for current authorization and metadata without icons, model catalogs or connectors. Only the skill-center display reads `employee/me` for card icons. Deploy the lightweight catalog endpoint before updating clients; permission checks remain fresh and failures stop the dependent operation.

Personal skills live below `dataDirectory` in employee-hashed directories. Confirmed chat editing atomically replaces SKILL.md while preserving resources, enablement, invocation flags and extra metadata. Numeric versions increment automatically. Replacement ZIPs require explicit confirmation and the current revision. Stale revisions return conflict. Removal moves the skill out of the visible directory before cleanup; failed cleanup is logged.

Missing personal versions read as 1.0.0; numeric versions such as 2.3 remain supported. `lfclaw-enabled` defaults to true. Disabled skills are omitted from new catalogs and rejected on later reads. A broken definition is isolated from other directory entries and can still be removed.

The Host reports name, description, version, personal source and enabled state using a random device ID stored in `.device-id`. Full snapshots replace that employee/device inventory after import, edit and removal, with periodic retry. The server verifies the reported employee against authentication and rejects extra skill fields. No definition, script, attachment or local path is uploaded.

<a id="model-experience"></a>
## Model Experience

### Skills and personal editing

#### What the model sees

`save_personal_skill` saves only after the user requests creation and confirms the content. `read_personal_skill` returns the current definition and revision; `update_personal_skill` updates it after the user confirms the revised content and rejects a stale revision. The standard tool log records each operation. Personal invocation names start with `my-`; enterprise names include a stable resource suffix. Use skill inserts a reference chip showing the original skill name; its stored invocation stays unique and serializes to a leading `/name` so tool-skill deterministically injects the definition, including user-only skills. User and model invocation flags remain independent. Enterprise and personal providers return their original display names with loaded definitions. The Host records that name with the explicit invocation, so sent messages show the skill label without changing the unique loader key.

#### Token effect

Loaded skill definitions, personal editing tool parameters and results consume request context. `tool-skill` records loaded definitions; unloaded personal attachments do not enter model requests.

#### KV Cache effect

Loading a skill or reading an edited definition appends conversation content; saving does not rewrite recorded instructions. Enablement changes subsequent catalogs and may invalidate the cache from the first changed entry.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Personal definitions do not synchronize across devices. Administrators may see stale metadata for offline devices; failed reporting does not undo a local save, and the Host retries.
- Disabling, removing or revoking a skill does not erase instructions already present in conversations.
- Enterprise cache retention protects running tasks; this package does not garbage-collect prior versions.

<a id="dev-note"></a>
### Dev Note

Tests cover ZIP rejection, employee isolation, revision conflicts, resource-preserving edits, replacement, disablement, cache restart, rollback and UI failure states. See the `LFClaw/02-管理端/server/README.md` for report endpoints and administrator access.
