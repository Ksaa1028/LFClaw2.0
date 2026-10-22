---
description: "Use authorized enterprise connectors and manage personal MCP connections and accounts."
kind: "package-reference"
---

# LFClaw connector center

English | [中文](README.zh.md)

## Summary

Employees can use authorized enterprise connectors and manage personal remote and local connectors. Account settings stay in the Host or enterprise service; the renderer receives no saved credentials. Tool discovery and execution check current authorization; expired accounts or failed synchronization remove tool registrations.

## Table of Contents

- [Connections and permissions](#connections-and-permissions)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="connections-and-permissions"></a>
## Connections and permissions

Employee-owned enterprise OAuth uses a one-use callback on the desktop Host's `127.0.0.1` interface. The Host forwards the authorization code through the current employee's authenticated enterprise connection; the enterprise server owns discovery, PKCE, code exchange, token storage, refresh and tool calls. The configured enterprise IP address remains unchanged and needs no public OAuth callback. Both client and server must support this flow; an older server produces a localized update prompt. The browser must run on the Host machine, and the provider must accept loopback redirects. `oauthFlowTtlMs` expires waiting callbacks; disconnect, replacement and Host disposal close their listeners. Shared administrator-owned OAuth retains the server callback flow.

The page keeps its heading, tabs and search visible while connector cards scroll within the remaining space.

Directory views reuse Host snapshots for up to `refreshIntervalMs`; the enterprise revision watch continues to update them. Manual refresh, details, account operations and tool calls request fresh server state. The composer requests enterprise and personal directories concurrently.

Enterprise connectors support server-defined credential fields, API tokens and browser OAuth before tools are available. Accounts can be shared by the enterprise or bound separately by each employee. The renderer receives field descriptions and status, never saved secrets. Credential submissions include the displayed configuration digest; changed destinations require refreshed forms. Legacy WeChat bindings remain readable. Non-mall discovered tools are available automatically; connector assignment and enabled state still apply. Mall connectors retain tool and floor authorization.

Connector catalogs larger than `inlineToolSchemaChars` (default 16000 serialized characters) expose one discovery/call tool instead of every full parameter schema. `list` searches names and descriptions, `describe` reads an exact definition or a JSON Pointer within it, and `call` validates the original input schema before using the original invocation callback. Discovery responses are logged tool results. `toolCatalogPageSize` (10), `toolDefinitionPageChars` (12000) and `toolSummaryChars` (320) bound pages; larger definitions return continuation offsets without deleting constraints. Enterprise and personal connectors share this behavior; configuration and authorization changes invalidate discovery and calls. Small catalogs retain their native tool names. These limits reduce individual connector declarations; they do not increase the configured model context window.

Personal remote connectors support OAuth discovery, dynamic registration, PKCE, token refresh and a one-use loopback callback. A preregistered public client can specify Client ID, issuer and scopes. Save first, then connect from the details panel; the browser returns to a local callback and the Host refreshes tools. `oauthFlowTtlMs` bounds interactive authorization. Tokens are stored under the employee's private local directory; editing configuration or disconnecting invalidates pending callbacks and prior credentials. Manual Header and stdio environment configuration remains available. Local disconnect does not revoke consent on the provider's website.

The catalog includes validated server-supplied connector icons. A connector without an uploaded icon keeps the default link icon. Enterprise MCP connections can use Streamable HTTP or legacy SSE with server-held custom headers; the enterprise gateway enforces employee floor parameters without requiring MCP configuration changes.

The server's per-connector tool visibility setting keeps authorized connector cards visible while hiding tool names, counts, and descriptions from the client when disabled. Authorized agent tools remain callable under employee and tool permissions.

The renderer accepts catalogs from an older Host that omit icon and tool-visibility fields. It uses the default icon and hides tool details until the Host supplies an explicit visibility value. When rebuilding this package, emit `lib/types` before bundling because the Host bundle reads the emitted entry.

The desktop Host reads the current employee's connector catalog through `enterpriseConnection`, which keeps the activation token outside the renderer. The client route returns only authorized connector names and configured tool summaries. Opening a connector calls the employee tool-list endpoint through the Host and shows whether live discovery succeeds. An unknown connector ID is rejected before forwarding. Discovered, authorized MCP tools register with the agent runtime; every call goes back through the enterprise server, which rechecks employee, connector, tool, and mall data permissions. A failed or revoked catalog clears those registrations.

Authorized, reachable tools register automatically for normal chat. The composer's Add menu offers a connector picker grouped into Enterprise Connectors and My Connectors, with search across both groups; a connector's detail panel offers Use connector. Both create a chat draft that names the selected connector so the employee can give a specific task. Selection does not bypass live tool discovery or server-side permissions; a hidden tool list stays hidden in the picker and detail panel.

An enterprise connector without available tools cannot start a chat or run a tool check and is omitted from the composer picker. Its account form remains available to connect and discover tools. Mall tools also require administrator authorization and employee floor permissions. The Host supplies availability separately from tool-list visibility.

The page separates Enterprise Connectors and My Connectors. Personal connections support SSE, Streamable HTTP, custom headers, and stdio commands with arguments and explicit environment variables. Employees add connections through New Connector and edit saved settings through View details → Edit Config; JSON import is unavailable. Enabled manual configurations are checked before saving; OAuth configurations are saved before browser authorization, and disabled configurations can be saved offline. Failed discovery retains the form without saving; HTTP 405 prompts users to check the transport setting. Employees can also enable, disable, or remove connections. Edits and removal require the current revision. Catalog actions appear in the page header; search appears below the tabs.

Personal settings live in `dataDirectory`, partitioned by the activated employee ID. The Host saves credentials with the configuration and returns blank Header and environment values to the renderer; blank values preserve an existing secret only for the unchanged URL or command. Stdio inherits the subprocess service's scrubbed parent environment plus explicit user variables. Personal tools register automatically and appear in the composer picker when reachable. Every execution rechecks the employee and saved revision; disabling, removal, account changes, and plugin disposal prevent further calls. The Host rechecks enterprise policy for remote requests: a service origin configured with mall data permissions must use the enterprise connector.

`requestTimeoutMs` bounds each connection and tool operation; `maxConfigBytes` bounds management request bodies. A visible card does not imply reachability. The Host and enterprise page long-poll `employee/connector-catalog` with its revision. Changes abort prior calls, remove old runtime tools and update displayed floor permissions; late discoveries and results cannot restore an invalidated generation. Failed synchronization clears tools and displayed authorization, then retries after `refreshIntervalMs`. The server bounds long-poll waits with `mcpTimeoutMs`; the enterprise connection timeout must exceed that wait. Personal refresh isolates a failed MCP so other personal tools remain available.

<a id="model-experience"></a>
## Model Experience

### Authorized MCP tools

#### What the model sees

Enterprise tools use `lfclaw_<tool>_<digest>` names. Enterprise mall tools describe the current authorized floors and omit server-owned identity arguments from model schemas. These schemas and tool results use the standard Session log. Enabled personal MCP tools contribute discovered schemas and connector-qualified descriptions to model requests. Their calls and results use the standard MCP presenter and Session tool log. Secret configuration values and management forms are not model input.

#### Token effect

Tool descriptions and schemas enter each request while registered. Calls and results remain in history until compaction; disable unused connectors to reduce schema tokens.

#### KV Cache effect

A permission revision can change tool descriptions or remove tools, invalidating the request prefix from the first changed definition. Existing call and result history remains append-only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Personal configurations do not synchronize across devices. The protected-origin check cannot replace authentication inside the remote MCP: that service must enforce its own data permissions for all other entry points. Existing conversation text is not erased when a connector is removed.

A query rejected with `MCP_DATA_FORBIDDEN` keeps the authorized tool registered so the same conversation can query an allowed floor immediately. Revoked connector access and expired authentication still clear registrations. Tool descriptions instruct the model to return available floor data and explain unavailable floors without asking the user to expand access or start another conversation.

<a id="dev-note"></a>
### Dev Note

Account credentials remain in the Host or enterprise service; the UI receives only authorized display data.
