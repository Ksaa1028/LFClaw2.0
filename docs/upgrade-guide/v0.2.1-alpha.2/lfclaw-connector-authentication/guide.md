---
kind: upgrade-guide
description: "LFClaw connector catalogs expose generic credential metadata that requires an updated employee client."
---

# LFClaw connector authentication

English | [中文](guide.zh.md)

## Change

Enterprise connector catalogs now return `account.kind: "credentials"` for token, custom-field and OAuth bindings, including legacy employee WeChat bindings. Older clients do not recognize this metadata. The updated client accepts both the legacy WeChat metadata and the generic metadata. Saved legacy credentials remain readable; Session data is unchanged.

## Migration

1. Rebuild and restart the employee desktop Host and client before updating the enterprise server. Deploy both components from the same release.
2. For hosted enterprise OAuth, set `LFCLAW_OAUTH_CALLBACK_URL` to the externally reachable HTTPS address ending in `/lfclaw/api/connectors/oauth/callback`. The development patch defaults to a loopback address usable only from the server's own computer. Providers without dynamic client registration require a registered public Client ID and issuer.
3. Select the connector's authentication type and account owner in the administration page. Shared credentials are entered through the administrator account dialog; employees bind their own accounts in connector details. Changing the destination or credential definition requires reconnecting.
4. Confirm connector details show the account form even before tools exist. Complete authorization with your account and verify that discovered non-mall tools appear. Mall connectors continue to require tool and floor authorization.
