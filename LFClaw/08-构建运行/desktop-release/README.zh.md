# Windows 客户端更新发布

[English](README.md) | 中文

<a id="windows-客户端更新发布"></a>

根目录一键打包脚本内置 LFClaw 更新地址 `http://8.216.38.213:39811/lfclaw-updates/win-x64/`，不携带 DeepSeek Harness 更新源或强制更新策略。版本采用独立日期格式，例如 `2026.10.21-9`；文件名使用发布编号 `2026102109`。客户端只提示更高版本，下载和安装分别由用户选择。

安装器没有 Windows Authenticode 签名。更新清单使用 Ed25519 签名，安装包通过 SHA-512 校验；HTTP 不提供传输保密。公钥随客户端内置，私钥仅保存在维护者用户目录 `.codex/lfclaw-release/update-private.pem`，不提交仓库、不放入服务器或安装包。维护者须安全备份该私钥；不能通过换一把钥匙让已安装客户端信任新发布。

已安装且没有更新配置的旧包无法通过上传文件获得更新功能，必须先手动覆盖安装带此功能的版本。该限制不能通过更改服务器清单消除。新客户端停用原更新源，不检查其版本；后续只信任 LFClaw 签名清单。全量下载安装器，不使用依赖 SemVer 文件名替换的差分下载。

一键构建通过真实界面检查后，执行 `node LFClaw/08-构建运行/desktop-release/pack.mjs <发布编号>`，输出单个 `lfclaw-win-x64-<发布编号>.tar.gz`。维护者上传到服务器 `/opt/lfclaw-enterprise/packages/`，先使用 `.uploading` 后缀并核对 SHA256，确认后改为正式归档名。从已校验归档提取 `deploy.mjs` 到临时文件并执行，传入归档绝对路径。部署器验证归档成员、文件大小、哈希、清单签名及版本递增，先发布不可变安装包，再原子替换更新清单。中断后不能覆盖同编号的不同文件；检查现状后再操作。

服务器管理模块提供只读静态下载，默认位置是部署根目录的 `desktop/win-x64/` 和 `desktop/mac-arm64/`；可通过管理端配置的 `desktopDirectory` 设置专用根目录。该目录不放业务数据或凭据。发布成功后，Windows 与 macOS 分别只保留最新两个版本，删除更早的安装包、blockmap 和对应归档，不另存服务器历史备份。部署器校验安装包后对对应平台调用 `retention.mjs`。清理拒绝删除当前或上一版清单引用的文件；请求已清理版本的客户端须刷新更新清单。运行 `node --test LFClaw/08-构建运行/desktop-release/retention.test.mjs` 验证保留规则。签名清单绑定版本、安装包名、大小和哈希；缺失签名、篡改内容、外站地址和未授权的差分包字段均被拒绝。

发布 Apple Silicon 版本时，从对应 GitHub Actions 产物下载 DMG 并核对其 SHA-256，然后执行 `node LFClaw/08-构建运行/desktop-release/pack-mac.mjs <发布编号> <已校验的DMG路径>`，生成 `lfclaw-mac-arm64-<发布编号>.tar.gz`。按 Windows 相同的归档校验和 `packages/` 部署流程传输发布。内置 LFClaw 更新地址的 Mac 包可发现签名清单中的较新版本，经用户确认后下载并校验 DMG，再打开供用户在 macOS 中手动安装。没有内置该地址的旧 Mac 包仍需手动安装一次。未签名 DMG 不支持原地自动安装。

交付前运行签名及更新协调器测试、实际包界面检查，再运行 `node apps/desktop/scripts/qualify-lfclaw-update.mjs 2026.10.21-10 2026.10.21-9 --direct` 的真实 Electron 联网资格检查（参数依次为线上版本、模拟已安装版本；`--direct` 仅令隔离测试绕过系统代理），确认低版本能够发现线上新版、验证签名并完整下载。资格检查禁止执行安装器，不等同于用户数据保留的实际安装升级验收。

## 知识库安装包同步

<a id="知识库安装包同步"></a>

客户端发布后的知识库入口为[《LfClaw 企业版二开说明》](https://bxz6lqekwy.feishu.cn/wiki/DHIgws6jkiizt1kOWsOcdr1jnSg)的“十三、最新安装包”，底层文档 ID 为 `HuQ4dRNsZoEx3KxnLBzcj1sFnOJ`。维护代理按用户授权主动完成同步；这是每次发布的交付步骤，不是后台定时任务。

先按 work-kb-maintainer 与飞书文档技能读取知识库现行规则和目标章节，核对线上版本、平台架构、文件大小及哈希。将已验证的同一安装包上传为对应平台附件，原位替换旧的最新入口，补充固定版本下载链接、版本号、最后更新日期和升级限制。Windows 与 macOS 分别以实际发布产物为准；没有新包的平台标注历史版本及待发布状态，不把旧包改名为新包。macOS 产物来源遵循项目 AGENTS.md。

写入后回读确认附件文件名、大小和链接，再追加知识库“更新维护日志”（文档 ID `Am15doVKdohdqxxntSkcrZQAngc`）及本地工作记录。上传或文档写入失败时保留可用入口，报告同步未完成；不得只更新版本文案而继续挂旧包，不得将未发布的本地改动写成已交付。
