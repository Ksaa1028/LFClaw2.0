# 专家管理资源

[English](README.md) | 中文

<a id="专家管理资源"></a>

本资源用于 LFClaw 专家中心的对话式创建、资料转化和修改流程。员工点击“创建专家”“创建专家团”或“对话修改”，进入带有专家管理技能的新会话；在对话中补充需求后，由工具保存配置，不要求填写创建表单。

参考原包版本为 `5.8.2-wb.41111488.gb8f6c953.haebd5991e0e2`，SHA-256 为 `9e526425cb811f3e92d5276a0ecb71ced1aaa258dbb9acf907fd7d229ea0e14c`。

## 文件

<a id="文件"></a>

| 文件 | 用途 |
|---|---|
| [专家管理.zip](专家管理.zip) | LFClaw 适配技能，标识 `lfclaw-expert-manager`，版本 `1.0.0`；依赖专家中心提供的管理工具 |
| [参考原包](参考原包/expert-manager.zip) | 用户提供的 WorkBuddy 原始包，保留原始字节、脚本及许可证，不作为 LFClaw 安装包直接运行 |
| [参考规范](参考规范/) | 从原包提取的 Agent、专家配置、专家团和头像规范，内容保持原样 |
| [LICENSE.txt](LICENSE.txt) | 原包附带的 Apache License 2.0 |

## 适配

<a id="适配"></a>

沿用原包的交互与资料转化两种输入、单专家与专家团区分、先读取再修改、固定标识与展示名称分离、校验后注册，以及真实成员产出再汇总的原则。LFClaw 原生配置使用员工本人专家 ID、工作指令、成员 ID、企业技能与连接器 ID，不强制用户填写 WorkBuddy 市场要求的中英文字段、头像或行业编码。展示名称可以修改，记录 ID 保持不变。默认给出三个标签和三个示例问题，已有配置仍按 LFClaw 的数量上限校验。

| WorkBuddy 流程 | LFClaw 实现 |
|---|---|
| 初始化目录、编辑文件 | 专家管理技能在对话中整理配置 |
| 读取已有专家 | `list_expert_resources` 和 `read_personal_expert` |
| 校验和注册到市场清单 | 单专家使用 `save_personal_expert`，新专家团使用 `create_personal_expert_team` 整组校验并保存；修改校验修订摘要 |
| TeamCreate、Agent、SendMessage | 当前会话主理人使用 DSH `subagent` 委派真实任务，运行时回传结果，`send_message` 补充任务 |
| WorkBuddy 个人专家目录 | 本人的企业服务配置；聊天与执行继续在本机 |

原包脚本面向 WorkBuddy 的目录、市场清单和会话标识，LFClaw 适配不执行这些脚本。参考规范中的命令和强制目录要求仅描述原平台，不适用于 LFClaw。原包没有独立图标，本资源不伪造图标或声称完成头像生成。

适配后的技能包保留许可证和来源说明；运行时的技能正文由 `packages/client/ui-lfclaw/src/expert-manager-skill.ts` 维护。资源 ZIP 与运行时正文一致性通过归档内容比较验证。企业专家发布仍由管理员操作；专家团真实执行依赖所选预设中可用的子代理工具，不能在工具缺失时模拟成员结果。
