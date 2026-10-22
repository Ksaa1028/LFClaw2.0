---
description: "确认后删除工作区会话，保留底层日志和文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-actions

[English](README.md) | 中文

## 概述

用户可在工作区会话菜单确认删除会话。删除会停止所选会话，并使其不再出现在应用列表中，但保留原始日志和工作区文件。失败时确认框保留以便重试；成功提示独立于被删除的行。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#implementation)
- [模型体验](#model-experience)
- [已知限制与待完成工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

随附桌面组合通过 connection 和 Session Controller 服务挂载本插件。“删除会话”位于工作区会话菜单末尾。取消不产生写入；确认后停止活动并释放 API 持有的 Agent，再持久化删除标记和通知列表。删除当前会话时，归档投影清空会话选择。应用级覆盖层在会话行卸载后仍保留成功提示。

删除是逻辑删除，与归档不同：刷新和重启不会重新列出会话，应用不能重新打开或继续。原始日志保留以供运维恢复，不擦除工作区文件。只停止并删除所选会话，不检查或删除其分叉与子会话。外部组件持有的运行实例及未释放的存储句柄会阻止删除。

<a id="implementation"></a>
## 实现说明

经过本机连接认证的 Host 接口 POST `/api/sessions/delete` 接受 `sessionId`。JSONL 后端在原会话目录同步写入 `session.deleted`，不修改已提交的日志代际。不支持删除的后端拒绝请求。失败时保留确认框，不显示成功提示。删除已提交后列表刷新失败，不将该删除报告为失败。

<a id="model-experience"></a>
## 模型体验

### 会话删除

#### 模型看到什么

`session.deleted` 标记属于存储元数据。本包不提供模型指令、工具定义或模型可见结果；确认删除后通过 Session Controller 停止所选会话活动。

#### Token 影响

菜单、确认框和删除标记不增加模型输入 token。本包不重新提交保留的原始日志。

#### KV Cache 影响

删除不发起新模型请求，也不改写历史消息。提供方缓存回收不由本包负责。

## 已知限制与待完成工作

<a id="known-limitations-and-deferred-work"></a>

- 应用尚无恢复入口。旧版程序不认识删除标记，不支持降级后使用同一会话目录。
- 删除保留原始日志和工作区文件，不提供物理数据擦除。

<a id="dev-note"></a>
### 开发备注

会话生命周期及后端删除行为由 Session Controller 和持久化包负责。
