---
kind: upgrade-guide
description: 桌面和 Host API 移除个人连接器 JSON 导入。
---

# 个人连接器配置

[English](guide.md) | 中文

## 变更

“我的连接器”不再提供“导入配置”。personal-connectors HTTP 接口对 `operation: "import"` 返回 HTTP 400。已有连接器仍可使用。

## 迁移

1. 通过“新建连接”逐个添加连接器。使用 Host 接口的集成须逐个提交 `operation: "save"` 请求，不再导入 `mcpServers` JSON。
2. 通过“查看详情 → 编辑配置”查看或修改已有连接。
3. 确认已保存连接器仍在列表中，并通过“检查连接”获取工具。
