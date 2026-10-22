# LFClaw 员工客户端

[English](README.md) | 中文

<a id="lfclaw-员工客户端"></a>

员工客户端基于 DSH Electron，通过插件提供企业激活、模型、技能、连接器、专家及会话分享。管理后台是独立 Web 应用；Web 预览不能代替安装包验收。

## 运行与授权

<a id="运行与授权"></a>

客户端正式运行、本地开发与人工联调统一连接 `http://8.216.38.213:39811/lfclaw/api`。凭据保存在 Host，每次打开工作区重新验证；连接失败不回退到本地服务。更换地址需用户明确要求并重新激活，本机聊天与文件保留。

LFClaw 停用原平台反馈命令、反馈弹窗、消息评分及会话记录遥测上传，并隐藏桌面日志下载入口；已有本地反馈记录保留。企业服务不接收这些反馈。

## 功能与交付说明

<a id="功能与交付说明"></a>

- [员工激活](../../packages/client/ui-activation/README.zh.md)：凭据、模型目录及自动续接。
- [技能管理](../../packages/client/ui-enterprise-skills/README.zh.md)：企业授权与个人技能。
- [连接器](../../packages/client/ui-enterprise-connectors/README.zh.md)：企业代理与个人 MCP。
- [专家助手](../../packages/client/ui-lfclaw/README.zh.md)：对话管理、专家任务与会话分享。
- [客户端发布](../08-构建运行/desktop-release/README.zh.md)：版本归档、上传、验签与回退。
