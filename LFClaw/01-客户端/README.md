# LFClaw Employee Client

English | [中文](README.zh.md)

<a id="lfclaw-员工客户端"></a>

The employee client extends DSH Electron with activation, models, skills, connectors, experts and session sharing. Administration uses a separate Web application; Web previews do not replace installer qualification.

## Operation and authorization

<a id="运行与授权"></a>

Production operation, local development and manual integration use `http://8.216.38.213:39811/lfclaw/api`. Credentials stay in the Host and are verified on workspace entry; connection failure does not fall back to a local service. Address changes require explicit user direction and reactivation; local chats and files remain.

LFClaw disables upstream feedback commands, dialogs, message ratings and session-log telemetry upload, and hides desktop log downloads. Existing local feedback records remain; the enterprise service does not receive this feedback.

## Features and delivery

<a id="功能与交付说明"></a>

- [Employee activation](../../packages/client/ui-activation/README.md): credentials, model catalog and continuation.
- [Skill management](../../packages/client/ui-enterprise-skills/README.md): enterprise authorization and personal skills.
- [Connectors](../../packages/client/ui-enterprise-connectors/README.md): enterprise proxy and personal MCP.
- [Expert assistant](../../packages/client/ui-lfclaw/README.md): conversational management, expert tasks and sharing.
- [Desktop release](../08-构建运行/desktop-release/README.md): versioned archives, upload, signature verification and rollback.
