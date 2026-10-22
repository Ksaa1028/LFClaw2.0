---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-skill-invocation-display-name

[English](2026-10-16-skill-invocation-display-name.md) | 中文

## 概述

显式技能调用增加可选的展示名称记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

没有 displayName 的旧记录仍然有效。字段缺失时读取方继续使用调用名称；LFClaw 对话界面还能从旧调用名还原可读的技能标识。写入方保留唯一名称和技能正文，调用查找及模型上下文不变。

<a id="verification"></a>
## 验证

tool-skill、技能名称投影及用户文本的定向测试通过，共 55 项；改动包类型检查通过。

<a id="dev-note"></a>
## 开发备注

无。
