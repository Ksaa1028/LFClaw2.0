# LFClaw Project Workspace

English | [中文](README.zh.md)

<a id="lfclaw-项目工作区"></a>

LFClaw extends DeepSeek Harness with an employee desktop and enterprise administration Web app. Read the [product and implementation baseline](06-架构设计/产品与实施基线.md) and [AGENTS.md](AGENTS.md) before maintenance. Source-directory READMEs own feature, configuration and limitation details; work logs retain historical validation.

## Project navigation

<a id="项目导航"></a>

| Directory | Contents |
|---|---|
| [Employee client](01-客户端/README.md) | Desktop features, authorization and delivery |
| [Administration](02-管理端/README.md) | Enterprise APIs and administration Web |
| [Requirements](03-需求文档/README.md) | PRD and original requirements |
| [UI design](04-UI设计/README.md) | Confirmed designs and early concepts |
| [Module plan](05-模块计划/README.md) | Implementation order and acceptance |
| [Architecture](06-架构设计/README.md) | Application responsibilities and design |
| [Work log](07-工作日志/README.md) | Executed work, evidence and remaining issues |
| [Build and operation](08-构建运行/README.md) | Local launch and version publication |
| [Enterprise resources](09-资源/README.md) | Skills, connectors and expert resources |

## Source locations

<a id="源码位置"></a>

- [Expert assistance](../packages/client/ui-lfclaw/README.md) and `packages/client/ui-*` plugins provide employee features.
- [Administration Web](02-管理端/admin-web/README.md) and [enterprise API](02-管理端/server/README.md) own server-side administration.
- The [Web composition](../packages/bundle/web-app/README.md) assembles client plugins; the [desktop shell](../apps/desktop/README.md) owns Electron packaging and platform integration.

## Verification and publication

<a id="验证与发布"></a>

See [build and operation](08-构建运行/README.md) for source launch and [versioned archive publication](../docs/cookbook/lfclaw-release-deployment.md) for server releases. Daily 15:00 code synchronization verifies and pushes both target repositories; installer builds, macOS workflows and server publication run when the user requests a release. Fix failed checks before publication; unverified features and mock data are not production delivery.
