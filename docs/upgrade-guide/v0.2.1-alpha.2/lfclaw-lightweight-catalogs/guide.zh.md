---
kind: upgrade-guide
description: "升级 LFClaw 客户端前必须提供轻量模型、技能、连接器和专家接口。"
---

# LFClaw 目录接口

[English](guide.md) | 中文

## 变更

LFClaw 模型发现与请求准备改用 `GET /api/employee/model-catalog`，技能提供者改用 `GET /api/employee/skill-catalog`。旧企业服务器没有这两个接口，更新后的客户端无法通过旧服务器准备模型或技能。输入框连接器还需要 `GET /api/employee/identity` 与 `GET /api/employee/connector-picker`；专家和专家团需要 `GET /api/employee/expert-picker`。缺少接口时，相应列表或个人连接器操作会失败。现有员工接口继续供展示和旧客户端使用。

## 迁移

1. 按[LFClaw 发布流程](../../../cookbook/lfclaw-release-deployment.zh.md)，先部署包含全部五个接口的企业服务器，再更新桌面端。
2. 确认携带有效凭据的目录请求返回已授权模型元数据，不含内嵌图标的技能元数据、连接器名称及可用状态、不含工作指令的专家和专家团摘要；未认证请求必须返回 HTTP 401。
3. 更新桌面端，选择模型并发送消息，确认技能准备及模型请求成功，并在刷新目录后分别打开各输入框选择器。回退时不要让更新后的客户端连接旧服务器。
