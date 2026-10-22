---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-skill-invocation-display-name

English | [中文](2026-10-16-skill-invocation-display-name.zh.md)

## Summary

Records an optional display name with an explicit skill invocation.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-skill-invocation-display-name
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "d83b2b23cf76b7b1a39f1c7c3e3afb05c0e837e8fc2caafb9df933f9ecb53869"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "bfa4ae60a37b2824b6b0a34f0da542b0d5269a1e895e09ef0ee5fef01ac7832f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "48795d918956da31f90083f05496b5d2ebddb1281860f0f8d908009208a5fb11"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "7657e81b57ee050fa99b8512f21d9b74d2c326357dd5291fee4c93868ecde02e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records without displayName remain valid. Readers use the invocation name when the field is absent; LFClaw transcript presentation can recover a readable slug from older invocation names. Writers keep the unique name and skill body unchanged, so invocation lookup and model context are unaffected.

<a id="verification"></a>
## Verification

Focused tool-skill, skill-name projector and user-text tests passed (55 tests); changed packages typechecked.

<a id="dev-note"></a>
## Dev Note

None.
