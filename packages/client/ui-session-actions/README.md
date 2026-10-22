---
description: "Delete a workspace session after confirmation while retaining its underlying logs and files."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-actions

English | [中文](README.zh.md)

## Summary

Users can delete a session from its workspace menu after confirmation. Deletion stops the selected session and removes it from subsequent application listings without erasing its raw logs or workspace files. Failed deletion keeps the confirmation dialog available for retry; successful deletion reports its result outside the removed row.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The shipped desktop composition mounts this plugin with the connection and Session Controller services. Delete session appears at the end of the workspace session menu. Cancel performs no write. Confirmation stops activity and releases the API-owned Agent before persisting the deletion marker and notifying the list. Deleting the current session clears its selection through the archive projection. The application overlay retains the success notice after the row unmounts.

Deletion is logical and distinct from archiving: refresh and restart do not list the session, and the application cannot reopen or continue it. Raw logs remain available for operational recovery; workspace files are not erased. Only the selected session is stopped and deleted; forks and child sessions are not inspected or deleted. Externally owned running instances and unreleased storage handles prevent deletion.

<a id="implementation"></a>
## Implementation

The authenticated local Host endpoint POST `/api/sessions/delete` accepts `sessionId`. The JSONL backend synchronously writes `session.deleted` in the original session directory without changing committed log generations. Backends without deletion support reject the request. Failure preserves the confirmation dialog and shows no success notice. A list refresh failure after committed deletion does not report that deletion as failed.

<a id="model-experience"></a>
## Model Experience

### Session deletion

#### What the model sees

The `session.deleted` marker is storage metadata. This package contributes no model instruction, tool definition or model-visible result; confirmed deletion stops the selected session's activity through the Session Controller.

#### Token effect

The menu, confirmation and deletion marker add no model-input tokens. Retained raw logs are not resubmitted by this package.

#### KV Cache effect

Deletion initiates no new model request and does not rewrite earlier messages. Provider cache eviction is outside this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No application restore entry exists. Older binaries do not understand deletion markers; downgrading against the same session directory is unsupported.
- Deletion retains raw logs and workspace files; it does not provide physical data erasure.

<a id="dev-note"></a>
### Dev Note

Session lifecycle and backend deletion behavior are owned by the Session Controller and persistence packages.
