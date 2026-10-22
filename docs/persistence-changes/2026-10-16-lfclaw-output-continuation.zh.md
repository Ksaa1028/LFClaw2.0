---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-lfclaw-output-continuation

[English](2026-10-16-lfclaw-output-continuation.md) | 中文

## 概述

增加 lfclaw-output-continuation 消息来源，持久化续接次数及上下文提示，用于企业模型的有限自动续接。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有消息保持有效。新来源在可扩展 MessageSourceMap 中使用独立 kind；读取器保留用户内容并按 notice 展示，不执行来源。只有运行中的 LFClaw 插件消费 attempt，在准入前校验正安全整数和配置上限，不因回放历史轮次结束而发起续接。已有判别值和字段不变。

<a id="verification"></a>
## 验证

企业激活和压缩相关 132 项测试通过，Host 与 Client TypeScript 检查通过。

<a id="dev-note"></a>
## 开发备注

无。
