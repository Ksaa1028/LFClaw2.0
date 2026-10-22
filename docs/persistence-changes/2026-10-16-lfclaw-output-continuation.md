---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-lfclaw-output-continuation

English | [中文](2026-10-16-lfclaw-output-continuation.zh.md)

## Summary

Adds the lfclaw-output-continuation message source with a persisted attempt count and context notice for bounded enterprise-model continuation.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-lfclaw-output-continuation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-16-skill-invocation-display-name"
    after: "6323807caccafbe7a292f5b53688bd547720637064a79c25663c4b8c296886c2"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-16-skill-invocation-display-name"
    after: "10ff0a625f92e821515d9d3a58c17e567f6ad7a3e910fea6e1b426f5233ee087"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-16-skill-invocation-display-name"
    after: "a4754233d8b0381e8a34116bd34504b41b0327bc37a56746abe4341bcbe45681"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-16-skill-invocation-display-name"
    after: "3c090ac2d2070ede0cdc09fe649f1c2de943b57933df765b52ab953ca65ed35b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages remain valid. The new source uses a distinct kind in the merge-extensible MessageSourceMap; readers retain user content and render its notice form without executing the source. Only the live LFClaw plugin consumes attempt, validates a positive safe integer against its configured limit before admission, and never starts continuation from replayed historical turn endings. No existing discriminators or fields change.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/client/ui-activation/tests packages/compaction/compaction-basic/tests/compaction-basic.spec.ts packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts: 132 tests passed; Host and Client TypeScript checks passed.

<a id="dev-note"></a>
## Dev Note

None.
