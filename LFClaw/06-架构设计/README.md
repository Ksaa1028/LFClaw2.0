# LFClaw Architecture

English | [中文](README.zh.md)

<a id="lfclaw-架构设计"></a>

The employee desktop extends DSH Electron and client plugins, reusing runtime, sessions and tools. Administration Web lives in `LFClaw/02-管理端/admin-web`; the sibling `server` hosts enterprise APIs through a dedicated DSH profile.

## Reading guide

<a id="阅读入口"></a>

- [Product and implementation baseline](产品与实施基线.md): maintenance scope and application responsibilities.
- [Architecture design](LFClaw_Architecture.md): system design and task breakdown.
- [Class diagram](class-diagram.mermaid) and [sequence diagram](sequence-diagram.mermaid): structural and interaction references.
- [DSH architecture](../../docs/architecture.md): underlying plugins and application launch rules.

## Data and permissions

<a id="数据与权限"></a>

The Host retains employee credentials; enterprise model keys are used only on the server. The enterprise service owns current resource authorization; the desktop uses local sessions, workspaces and task mechanisms. Shared conversations transfer file copies through the enterprise service and use recipient identity and permissions after claiming. Deployment configuration and implementations define capacities, timeouts and retention, rather than values in design diagrams.
