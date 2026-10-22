---
kind: upgrade-guide
description: LFClaw desktop uses employee activation instead of DeepSeek account onboarding.
---

# LFClaw desktop activation

English | [中文](guide.zh.md)

## Change

Desktop startup requires employee activation; DeepSeek credentials cannot activate LFClaw. Package names and session files are unchanged.

Application presets remove LFClaw personas, Harness identity openers and prescribed self-identification. Skills, commands, connectors and continuation remain available. New conversations avoid historical identity replies.

## Migration

Mall access uses employee selections only. Before upgrading, record department-inherited scopes; afterward save each employee’s required combination of five permissions. Existing personal selections remain; missing or invalid selections deny access. Department floor/self-operated fields grant nothing. The permissions API removes `mode` and rejects `permissions: null`; send arrays (`[]` denies all).

Update server/desktop together for `employee/connector-catalog` long polling. Failed synchronization clears authorization; permission changes cancel calls and discard old results. Gateway-enforced partial queries run per floor. All five permissions allow every assigned tool, including playground/unknown tools; partial permissions allow audited scoped tools only. Keep mall permissions enabled. No signing key/MCP changes are required; `mcpSecretEnv` is accepted but unused. Restrictions cover LFClaw calls only.

Shared ZIP validation requires re-uploading packages with invalid `name`, empty instructions or unsafe paths; originals remain untouched. Personal skills default missing version/`lfclaw-enabled` to `1.0.0`/enabled; numeric versions remain supported. Update server/desktop together for catalog refresh and invocation fields. Only specified personal metadata synchronizes, excluding instructions/attachments.

Web/Desktop disables `/feedback`, feedback dialogs, ratings and Session telemetry export. Existing local feedback remains readable through logs; enterprise feedback is unavailable. Header log downloads remain. No migration is required.

1. Start the enterprise service and obtain an employee activation code from its administrator.
2. Desktop and local manual testing now use `http://8.216.38.213:39811/lfclaw/api`. Restart the client and remove stale `LFCLAW_SERVER_URL` overrides. The local launcher checks production instead of starting a local enterprise service. Shipped activation config explicitly enables `allowInsecureHttp`; custom configs default to HTTPS or loopback HTTP.
3. Enter the activation code. Reopen the workspace to confirm saved credentials are verified. Changing the service address requires activation again.

Desktop offers authorized enterprise text models through the enterprise gateway; personal DeepSeek routes are disabled.

Custom configurations require activation `modelMaxRetries: 1`, server `modelTimeoutMs: 120000` and desktop `timeoutMs: 150000`, allowing server errors before client deadlines. Connector-center requires `dataDirectory`, `requestTimeoutMs: 30000`, `maxConfigBytes: 1048576`; personal storage must be private/local, separate from enterprise data. Shipped configurations include these. Update server/desktop together: remote personal connections fail closed without the policy endpoint.

Deletion writes `session.deleted` in the JSONL directory, preventing listing, opening or recreating that ID. Logs/workspace files remain. Older versions ignoring this marker may redisplay deleted conversations; do not reopen that directory with them.

Mixed floor and region queries now return the authorized intersection with an explicit unavailable-floor notice instead of rejecting the entire query. Update server and desktop together: a scope rejection keeps valid tools callable, while revoked access still clears them. Entirely unauthorized or malformed queries remain rejected.
