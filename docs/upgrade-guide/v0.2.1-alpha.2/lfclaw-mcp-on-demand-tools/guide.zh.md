---
kind: upgrade-guide
description: "大型 LFClaw MCP 工具目录用发现与调用入口替代逐个模型工具名称。"
---

# LFClaw MCP 工具按需读取

[English](guide.md) | 中文

## 变更

大型连接器目录现在注册一个支持 `list`、`describe` 和 `call` 的模型工具。此前每次请求都会包含全部 MCP 参数定义，普通聊天也如此。小目录保留已有工具名称。连接器页面和上游 MCP 工具名不变，调用继续检查员工、连接器与商场权限。

## 迁移

1. 重新构建连接器包并重启桌面 Host。提示词中若写死了大型目录的旧工具名称，改为要求使用对应名称的连接器。
2. 自定义部署仅在默认值不适合模型预算时，为 `lfclaw-connector-center` 设置 `inlineToolSchemaChars`、`toolCatalogPageSize`、`toolDefinitionPageChars` 和 `toolSummaryChars`。
3. 在已有会话继续，下一次请求使用当前工具目录，历史请求记录保留。确认连接器通过一个目录入口提供工具，普通消息不再携带该连接器的完整参数集合。
