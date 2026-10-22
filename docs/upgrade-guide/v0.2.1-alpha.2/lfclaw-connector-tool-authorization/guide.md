---
kind: upgrade-guide
description: "LFClaw non-mall connectors make discovered tools available without individual administrator approval."
---

# LFClaw non-mall tools become available automatically

English | [中文](guide.zh.md)

## Change

Previously every enterprise connector required `tools[].allowed` to be true. Non-mall connectors now expose all discovered tools, including existing entries with `allowed: false`. Connector assignment, employee status, enabled state and employee account requirements still apply. Mall connectors retain individual tool authorization and floor restrictions.

## Migration

1. Review non-mall connectors previously restricted by individual tool switches. Disable or narrow connector assignment if those employees must not access all discovered tools.
2. Reload the enterprise server and employee client with the updated build.
3. For employee WeChat accounts, save AppID and AppSecret in the client. Discovered tools become available without a subsequent administrator approval.
