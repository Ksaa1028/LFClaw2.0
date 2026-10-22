# LFClaw 构建与运行

[English](README.md) | 中文

<a id="lfclaw-构建与运行"></a>

本目录包含 LFClaw 项目的构建命令、运行说明和项目结构说明。

---

## 文档清单

<a id="文档清单"></a>

| 文件 | 说明 |
|------|------|
| \项目状态.md\ | 当前项目状态总结（服务状态、已完成功能、待办事项） |
| \LFClaw_Project_Structure.md\ | 项目文件结构说明 |

---

## 一键启动（Windows 本地开发）

<a id="一键启动windows-本地开发"></a>

在项目根目录双击 [一键启动LFClaw.bat](../../一键启动LFClaw.bat)，运行本地员工客户端并连接正式企业服务。管理后台地址为 `http://8.216.38.213:39811/`，企业 API 为同源 `/lfclaw/api`。依赖须已通过 pnpm install 安装，已有客户端须先退出再运行，以便加载新的连接配置。

启动器使用 [start-local.ps1](start-local.ps1)，设置正式企业地址，检查正式健康接口和首页文案接口后运行桌面。它不读取本地管理端数据，也不自动启动本地企业 API 或管理网页。正式服务不可用时直接报告错误，保留已有数据。

启动器与桌面启动日志输出到当前终端；首次准备未结束时不要重复运行。员工激活、模型、技能、专家、连接器和分享的人工联调以正式端为准，测试操作会访问正式业务数据，使用专用测试员工及资源。

桌面已有构建时运行 pnpm run start:desktop，缺少构建时运行 pnpm run dev:desktop。修改桌面源码后，先退出桌面，再执行 powershell.exe -NoProfile -ExecutionPolicy Bypass -File "LFClaw/08-构建运行/start-local.ps1" -RebuildDesktop。桌面首次构建和运行依赖准备可能超过三分钟，超时提示不会杀掉准备进程，请查看日志。

这是本地源码开发入口，不是正式发布部署。正式部署遵循[版本归档发布流程](../../docs/cookbook/lfclaw-release-deployment.zh.md)。
