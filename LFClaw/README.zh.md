# LFClaw 项目工作区

[English](README.md) | 中文

<a id="lfclaw-项目工作区"></a>

LFClaw 基于 DeepSeek Harness 提供员工桌面与企业管理 Web。维护前阅读[产品与实施基线](06-架构设计/产品与实施基线.md)和 [AGENTS.md](AGENTS.md)。具体功能、配置与限制由对应源码目录的 README 维护，历史验收保留在工作日志。

## 项目导航

<a id="项目导航"></a>

| 目录 | 内容 |
|---|---|
| [员工客户端](01-客户端/README.zh.md) | 桌面功能、授权与交付入口 |
| [管理端](02-管理端/README.zh.md) | 企业 API 与管理 Web |
| [需求](03-需求文档/README.zh.md) | PRD 与原始需求 |
| [UI 设计](04-UI设计/README.zh.md) | 当前设计及早期概念 |
| [模块计划](05-模块计划/README.zh.md) | 实施顺序与验收规则 |
| [架构](06-架构设计/README.zh.md) | 两端职责及技术设计 |
| [工作日志](07-工作日志/README.zh.md) | 已执行工作、证据与遗留问题 |
| [构建运行](08-构建运行/README.zh.md) | 本地启动与版本发布 |
| [企业资源](09-资源/README.zh.md) | 技能、连接器与专家资源 |

## 源码位置

<a id="源码位置"></a>

- [专家助手](../packages/client/ui-lfclaw/README.zh.md)及 `packages/client/ui-*` 插件提供员工功能。
- [管理 Web](02-管理端/admin-web/README.zh.md)与[企业 API](02-管理端/server/README.zh.md)拥有管理端实现。
- [Web 组合](../packages/bundle/web-app/README.zh.md)装配客户端插件；[桌面壳](../apps/desktop/README.zh.md)负责 Electron 打包与平台集成。

## 验证与发布

<a id="验证与发布"></a>

本地源码启动见[构建运行](08-构建运行/README.zh.md)，正式上传遵循[版本归档发布](../docs/cookbook/lfclaw-release-deployment.zh.md)。每天 15:00 的代码同步只验证并推送两个目标仓库；安装包构建、macOS 工作流及服务器发布在用户要求发布版本时执行。检查失败先修复，不把未验证功能或模拟数据当作正式交付。
