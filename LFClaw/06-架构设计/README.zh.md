# LFClaw 架构设计

[English](README.md) | 中文

<a id="lfclaw-架构设计"></a>

员工桌面扩展 DSH Electron 和客户端插件，复用运行时、会话及工具机制。管理 Web 位于 `LFClaw/02-管理端/admin-web`，企业 API 位于同级 `server`，通过专用 DSH profile 启动。

## 阅读入口

<a id="阅读入口"></a>

- [产品与实施基线](产品与实施基线.md)：维护范围及两端职责。
- [架构设计](LFClaw_Architecture.md)：系统设计与任务分解。
- [类图](class-diagram.mermaid)与[时序图](sequence-diagram.mermaid)：结构和交互参考。
- [DSH 架构](../../docs/architecture.zh.md)：底层插件与应用启动规则。

## 数据与权限

<a id="数据与权限"></a>

员工凭据由 Host 保管，企业模型密钥仅在服务器使用。企业服务负责当前资源授权；桌面使用本机会话、工作区与任务机制。分享会话通过企业服务传递文件副本，领取后使用接收人的身份和授权。容量、超时与保留期由部署配置及对应实现定义，不以设计图中的数值代替实际配置。
