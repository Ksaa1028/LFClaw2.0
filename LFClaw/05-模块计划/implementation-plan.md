# LFClaw implementation plan

Use this plan to keep LFClaw work incremental. Each module should leave behind real integration points, focused verification, and updated contributor notes.

## Delivery order

1. Project structure and coordination files.
2. Client workspace shell: navigation, workspace picker, local workspace state, and clear desktop-vs-web behavior.
3. Admin shell: login, layout, routing, permissions, and service-side API wiring.
4. Organization and employee management.
5. Skills and connectors.
6. Expert profiles and AI configuration.
7. Approval workflows.
8. Billing and quotas.
9. Client version management.
10. Notifications.
11. Backup and restore.
12. System status and operation logs.

## Acceptance rule

A module is not complete when it only renders plausible data. It is complete when the UI uses the intended runtime or backend source, exposes loading and failure states, and has a focused verification command or browser check recorded in [`contributors.md`](contributors.md).
