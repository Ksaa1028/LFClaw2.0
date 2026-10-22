---
kind: upgrade-guide
description: "LFClaw 连接器目录返回通用凭据描述，需要更新员工客户端。"
---

# LFClaw 连接器认证

[English](guide.md) | 中文

## 变更

企业连接器目录对 Token、自定义字段与 OAuth 绑定返回 `account.kind: "credentials"`，包括旧员工公众号绑定。旧客户端不认识此描述；新版同时接受旧公众号描述和通用描述。已保存的旧凭据继续可读，Session 数据不变。

## 迁移

1. 先重新构建并重启员工桌面 Host 与客户端，再更新企业服务端。两端使用同一发布版本。
2. 企业 OAuth 部署时，将 `LFCLAW_OAUTH_CALLBACK_URL` 设为外部可达、以 `/lfclaw/api/connectors/oauth/callback` 结尾的 HTTPS 地址。开发 patch 默认使用回环地址，只适用于在服务器本机打开浏览器。不支持动态客户端注册的服务需要预注册公开 Client ID 和签发者。
3. 在管理页选择认证类型和账号归属。共用凭据从管理员账号窗口填写；员工从连接器详情绑定自己的账号。修改目标地址或凭据定义后需要重新连接。
4. 确认尚无工具时，连接器详情也显示账号表单。使用自己的账号完成授权并确认非商场工具自动出现；商场仍需要工具与楼层授权。
