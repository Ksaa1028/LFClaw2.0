---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-lfclaw-session-sharing

English | [中文](2026-10-16-lfclaw-session-sharing.zh.md)

## Summary

Adds locally retained conversation share attribution after the inherited event prefix.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-lfclaw-session-sharing
baseline: false
changes:
  - root: "event:lfclaw/share-received"
    previous: null
    after: "a2f0250913d34f97f16f532da574329eb247be8f23f3088cc875b462372a67fb"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing sessions are unchanged. New readers replay lfclaw/share-received as a non-model-visible chat divider and retain sender, time and title after server expiry. Older readers that do not recognize this required discriminator refuse to open the new shared session before execution, rather than silently losing attribution. The current Session format version is retained; no committed generation is replaced.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/client/ui-lfclaw/tests/sharing.host.spec.ts packages/client/ui-lfclaw/tests/sharing.client.spec.tsx: 4 tests passed, including serialized receipt snapshot, recipient composition, independent file copies, duplicate claim and visible source divider.

<a id="dev-note"></a>
## Dev Note

None.
