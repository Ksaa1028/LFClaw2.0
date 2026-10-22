# LFClaw Enterprise Resources

English | [中文](README.zh.md)

<a id="lfclaw-企业资源"></a>

This directory stores resources for administrator upload. Resources are grouped by type and short named folders; each skill folder keeps its ZIP and icon separately rather than combining them into another archive.

## Categories

<a id="分类"></a>

| Directory | Contents |
|---|---|
| [Skills](技能/) | Named folders with uploadable ZIPs and separate icons |
| [Connectors](连接器/) | Connector configuration and delivery files |
| [Experts](专家/) | Expert configuration and delivery files |

## Inventory

<a id="资源清单"></a>

| Name | ID | Version | Skill package | Icon |
|---|---|---|---|---|
| Nuwa | `huashu-nuwa` | 1.0.0 | [Package](技能/女娲/女娲.zip) | [Icon](技能/女娲/图标.png) |
| Obsidian Notes | `obsidian` | 1.0.0 | [Package](技能/Obsidian笔记/Obsidian笔记.zip) | [Icon](技能/Obsidian笔记/图标.png) |
| PPT Master | `ppt-master` | 6.7.2 | [Package](技能/PPT大师/PPT大师.zip) | [Icon](技能/PPT大师/图标.png) |
| DingTalk Intelligent Corpus | `dingtalk-dvi-orchestrator` | 1.0.1 | Local ZIP with original credentials, excluded from Git | [Icon](技能/钉钉智能语料/图标.png) |
| Unified Lark Suite | `lark-unified` | 2.3.0 | [Package](技能/飞书统一套件/飞书统一套件.zip) | [Icon](技能/飞书统一套件/图标.png) |
| Expert Management | `lfclaw-expert-manager` | 1.0.0 | [Adapted skill](技能/专家管理/专家管理.zip), [source and adaptation](技能/专家管理/README.md) | None in original |
| Expert Migration | `expert-migration` | 1.0.0 | [Package](技能/专家迁移模板/专家迁移模板.zip), [template](技能/专家迁移模板/SKILL.md) | None |

The [senior developer expert parameters](专家/高级开发工程师/专家参数.json) derive from a user-supplied WorkBuddy export; [migration notes](专家/高级开发工程师/迁移说明.md) list skills and resources requiring separate handling.

## Organization

<a id="整理约定"></a>

Use the skill name for its folder and a short ZIP filename without stacked IDs, versions or language labels. Keep the ZIP and icon separate rather than packaging both into another delivery archive.

Standalone icons use PNG.

New skills use short Chinese folder and ZIP names matching the administration display name. Translate only the main SKILL.md description; preserve body, ID, other metadata, scripts, templates and references. Compare archive entries and file contents afterward and validate the complete archive against deployment limits.

The unified Lark archive retains its `lark-unified/` root, embedded Meegle skills and icons, with two entry descriptions localized. Icon metadata uses package-relative paths; source-device installation time and obsolete installation-content hashes are removed. ZIP validation does not establish Lark login or business API acceptance.

Nuwa comes from [alchaincyf/nuwa-skill](https://github.com/alchaincyf/nuwa-skill). With user confirmation, the upload removes promotional images, animation and the promo directory while retaining skill text, scripts, references and every persona example, changing only the main description. The complete original archive, source, digest and removal list remain in [source records](来源归档/女娲/来源与处理记录.json); promotional README image links may no longer display.
