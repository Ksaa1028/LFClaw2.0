---
kind: upgrade-guide
description: "LFClaw clients require lightweight model, skill, connector and expert endpoints before upgrading."
---

# LFClaw catalog endpoints

English | [中文](guide.zh.md)

## Change

LFClaw model discovery and request preparation now use `GET /api/employee/model-catalog`; skill providers use `GET /api/employee/skill-catalog`. Older enterprise servers lack these endpoints, so updated clients cannot prepare models or skills against them. Composer connectors also require `GET /api/employee/identity` and `GET /api/employee/connector-picker`; experts and teams require `GET /api/employee/expert-picker`. Missing endpoints cause the corresponding lists or personal connector operations to fail. The existing employee endpoint remains available for display and older clients.

## Migration

1. Deploy the enterprise server containing all five endpoints before updating desktops, following the [LFClaw release procedure](../../../cookbook/lfclaw-release-deployment.md).
2. Verify that authenticated catalog requests return authorized model metadata and skill metadata without embedded icons, connector names and availability, and expert/team summaries without working instructions. Unauthenticated requests must return HTTP 401.
3. Update desktops, select a model and send a message. Confirm that skill preparation and model requests succeed, and open each composer picker after refreshing its directory. Do not point updated clients at an older server during rollback.
