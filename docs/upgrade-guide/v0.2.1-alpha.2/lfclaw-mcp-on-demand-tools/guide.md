---
kind: upgrade-guide
description: "Large LFClaw MCP catalogs replace individual model tool names with a discovery and invocation entry."
---

# LFClaw MCP tools load on demand

English | [中文](guide.zh.md)

## Change

Large connector catalogs now register a single model tool supporting `list`, `describe` and `call`. Previously every MCP schema was present in every request, including ordinary conversations. Small catalogs keep existing tool names. The connector page and upstream MCP names are unchanged; calls retain employee, connector and mall permission checks.

## Migration

1. Rebuild and restart the desktop Host with the updated connector package. Large-catalog tool names previously copied into prompts must be replaced with a request to use the named connector.
2. For custom deployments, configure `inlineToolSchemaChars`, `toolCatalogPageSize`, `toolDefinitionPageChars` and `toolSummaryChars` on `lfclaw-connector-center` only if the defaults do not fit the model budget.
3. Continue in the existing conversation. Its next request uses the current tool catalog; historical request records remain intact. Confirm the connector is available through one catalog entry and that ordinary messages no longer include its complete schema set.
