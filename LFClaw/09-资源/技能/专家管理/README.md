# Expert Management Resources

English | [中文](README.zh.md)

<a id="专家管理资源"></a>

This resource supports conversational expert creation, source-material conversion and editing. Create expert, Create team and Edit in chat open conversations with the management skill; tools save configuration after requirements are refined, without a creation form.

The reference archive version is `5.8.2-wb.41111488.gb8f6c953.haebd5991e0e2`, SHA-256 `9e526425cb811f3e92d5276a0ecb71ced1aaa258dbb9acf907fd7d229ea0e14c`.

## Files

<a id="文件"></a>

| File | Purpose |
|---|---|
| [Adapted archive](专家管理.zip) | LFClaw skill `lfclaw-expert-manager`, version `1.0.0`, requiring expert-center management tools |
| [Reference archive](参考原包/expert-manager.zip) | User-supplied original WorkBuddy bytes, scripts and license; not executed directly as an LFClaw package |
| [Reference specifications](参考规范/) | Unmodified extracted Agent, expert, team and avatar specifications |
| [LICENSE.txt](LICENSE.txt) | Original Apache License 2.0 |

## Adaptation

<a id="适配"></a>

The adaptation retains interactive and source-material input, single/team distinction, read-before-edit, stable IDs separate from display names, validation before registration and real member results before synthesis. LFClaw configuration uses owned expert IDs, instructions, member IDs and enterprise skill/connector IDs. It does not require WorkBuddy marketplace bilingual fields, avatars or industry codes. Names are editable while IDs remain stable. Defaults offer three tags and three examples; existing configuration still follows LFClaw count limits.

| WorkBuddy process | LFClaw implementation |
|---|---|
| Initialize directories and edit files | The management skill organizes configuration in chat |
| Read existing experts | `list_expert_resources` and `read_personal_expert` |
| Validate and register in marketplace | `save_personal_expert` handles single experts; `create_personal_expert_team` validates and saves new groups atomically; edits check revisions |
| TeamCreate, Agent, SendMessage | The current lead uses DSH `subagent` for real tasks, receives runtime results and uses `send_message` for follow-ups |
| Personal WorkBuddy expert directory | Owned enterprise-service configuration; chat and execution remain local |

Original scripts target WorkBuddy directories, catalogs and session IDs and are not executed by this adaptation. Reference commands and required paths describe the original platform only. The original archive includes no independent icon; this resource neither invents one nor claims avatar generation.

The adapted skill retains license and source notes; `packages/client/ui-lfclaw/src/expert-manager-skill.ts` owns runtime text. Compare archive contents to verify ZIP/runtime consistency. Administrators still publish enterprise experts. Actual team execution requires subagent tools from the selected preset; missing tools must not be replaced with simulated member results.
