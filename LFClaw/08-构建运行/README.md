# LFClaw Build and Operation

English | [中文](README.zh.md)

<a id="lfclaw-构建与运行"></a>

This directory contains LFClaw build commands, operating guidance and project structure documentation.

---

## Documents

<a id="文档清单"></a>

| File | Description |
|------|------|
| `项目状态.md` | Project status, service state, completed features and remaining work |
| `LFClaw_Project_Structure.md` | Project file structure |

---

## Windows local development launcher

<a id="一键启动windows-本地开发"></a>

Double-click [一键启动LFClaw.bat](../../一键启动LFClaw.bat) in the repository root to run the local employee client against the production enterprise service. Administration is at `http://8.216.38.213:39811/`; the API is same-origin `/lfclaw/api`. Install dependencies with pnpm install first, and exit existing clients before launching to load new connection settings.

The launcher uses [start-local.ps1](start-local.ps1), selects the production enterprise address and checks health and branding endpoints before launching the desktop. It neither reads local administration data nor starts a local API or administration Web app. Production unavailability reports an error while preserving existing data.

Launcher and desktop logs use the current terminal; do not start duplicate preparation processes. Manual employee activation, model, skill, expert, connector and share integration uses production data, so use dedicated test employees and resources.

Use pnpm run start:desktop for an existing build and pnpm run dev:desktop when no build exists. After desktop source changes, exit the desktop and run powershell.exe -NoProfile -ExecutionPolicy Bypass -File "LFClaw/08-构建运行/start-local.ps1" -RebuildDesktop. Initial build and runtime preparation may take more than three minutes; timeout guidance does not kill preparation, so inspect logs.

This is a source-development entry. Production deployment follows the [versioned archive release procedure](../../docs/cookbook/lfclaw-release-deployment.md).
