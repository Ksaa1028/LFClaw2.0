---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-lfclaw-session-sharing

[English](2026-10-16-lfclaw-session-sharing.md) | 中文

## 概述

在继承会话前缀之后记录本地保留的会话分享来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有会话不变。新读取方将lfclaw/share-received投影为不进入模型上下文的聊天分界，服务端到期后仍保留发送人、时间和标题。不认识该必需判别符的旧读取方在执行前拒绝打开新分享会话，不静默丢失来源。保持当前Session格式版本，不替换任何已提交格式代际。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/client/ui-lfclaw/tests/sharing.host.spec.ts packages/client/ui-lfclaw/tests/sharing.client.spec.tsx：4项测试通过，覆盖序列化来源快照、接收方配置、独立文件复制、重复领取和可见来源分界。

<a id="dev-note"></a>
## 开发备注

无。
