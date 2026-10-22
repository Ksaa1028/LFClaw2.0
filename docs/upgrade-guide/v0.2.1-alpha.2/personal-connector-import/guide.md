---
kind: upgrade-guide
description: Personal connector JSON import is removed from the desktop and Host API.
---

# Personal connector configuration

English | [中文](guide.zh.md)

## Change

My Connectors no longer offers Import Config. The personal-connectors HTTP endpoint rejects `operation: "import"` with HTTP 400. Existing saved connectors remain available.

## Migration

1. Add each connector through New Connector. Integrations using the Host endpoint must submit individual `operation: "save"` requests instead of importing `mcpServers` JSON.
2. Open View details → Edit Config to inspect or change an existing connection.
3. Verify that saved connectors remain listed and Check connection discovers their tools.
