# LFClaw 版本部署

[English](lfclaw-release-deployment.md) | 中文

本文规定 LFClaw 桌面更新源和托管服务的发布输入及部署规则，供维护者使用。新服务使用 `/opt` 下的独立目录，不涉及已有的 `/opt/LfClaw` 服务。

## LFClaw 部署约定

新服务的部署根目录固定为 `/opt/lfclaw-enterprise`。发布文件、配置、数据、进程身份和网络路由均与已有的 `/opt/LfClaw` 服务分开。服务器登录方式和进程管理器由部署环境确定；除非另行提出并验证迁移，不从旧服务复制配置或数据。

传输只上传文件，不依赖上传文件夹。每次更新一个模块只上传一个 `.tar.gz` 归档到 `packages/`，再执行一次该模块的部署命令；命令按模块自动选择编号最新的完整归档，验证后才解包和启用。上传时先使用 `.uploading` 临时文件名，传完再改为正式归档名，避免读取到半个包。不可把本地构建目录或整个仓库复制到服务器。

对外显示的发布编号使用 `yyyyMMddxx`，日期按 Asia/Shanghai，`xx` 为当天从 `01` 开始的两位递增序号。发布前检查已使用的编号；同一编号不得指向不同内容。桌面更新组件使用 SemVer，因此 LFClaw 将发布编号转换为独立日期版本，例如编号 `2026102108` 对应 `2026.10.21-8`，不带底层 DSH 版本前缀。部署记录须保存两者的对应关系，客户端更新比较使用内部版本；不得让纯日期编号替代应用内部版本。

部署根目录只设 `packages/`、`admin/`，以及发布桌面更新时的 `desktop/`。管理端的运行文件、私有配置和业务数据分别放在 `admin/versions/`、`admin/config/`、`admin/data/`。客户端通过受认证的服务接口读取所需企业数据；将来若提供可公开的客户端 JSON，只能写入企业地址、功能和展示资源，不能包含服务端密钥、授权凭据或用户数据。

`packages/` 对每个模块只保留当前与上一版归档。Windows 与 macOS 分别保留最新两个已发布安装包版本及对应归档；发布成功后删除更早版本，不额外保留服务器历史备份。未完成上传使用非归档扩展名；验证失败则停止发布和清理。当前与上一版清单须引用保留文件。清理检查见[客户端发布器](../../LFClaw/08-构建运行/desktop-release/README.zh.md)。

客户端应能查看已安装版本及最新可用版本。发布程序须先验证完整归档、清单、每个安装包的大小和 SHA-512、公网读取及更新元数据，再让更新通道指向新版本。客户端只在服务器确认包完整且版本高于当前版本时提示更新；下载后仍须校验安装包并走现有安装确认流程。任何校验失败都不得提示安装。

本地 Windows 入口为仓库根目录的 `一键打包LFClaw-Windows.bat`。双击后安装依赖，按上海日期分配本地发布编号，构建连接已部署企业 API 的 Windows x64 未签名安装包，无需 `.env.windows` 或 Windows 签名证书；安装包内置 LFClaw 专用更新地址和发布公钥。未设置 `ELECTRON_MIRROR` 时，入口使用 npmmirror 的 Electron 镜像；下载内容按锁定 Electron npm 包自带的校验值验证。交付前，入口使用隔离的测试数据启动打包后的客户端，确认 LFClaw 侧栏已挂载；启动失败则停止交付。安装包复制到 `apps/desktop/.desktop-build/release-bundles/LFClaw-<release-id>-windows-x64.exe`；成功后打开该目录，失败后保留窗口。失败构建保留已占用编号。PowerShell 入口的 `-CheckOnly` 仅检查工具，不执行构建。没有更新源的旧客户端需要手动安装一次。后续 LFClaw 更新通过 Ed25519 签名清单及 SHA-512 安装包校验，下载和安装分别由用户选择；这不等于 Windows Authenticode 签名。脚本不会上传文件。GitHub 的 [Apple Silicon 手动工作流](../../.github/workflows/lfclaw-mac-arm64-package.yml) 可用相同编号生成未签名测试 DMG；它不能作为正式自动更新包。正式 macOS 更新包需要 Apple Developer ID 签名、公证及对应配置。Windows 本地打包也不能代替 macOS 签名构建。

企业内部工蜂仓库及用于 macOS 打包的 GitHub 仓库地址尚未确定。收到地址后，记录两个仓库各自负责的源码、工作流和发布产物，不把企业私有资源或凭据同步到公开仓库。

## 管理端服务器目录

管理端归档包含独立 LFClaw 企业 API 和已构建的管理员网页。打包的 dsh 启动器通过 server/cordis.admin.patch.yml 选择 lfclaw-admin profile，不加载通用 DSH Web。执行步骤见`LFClaw/08-构建运行/server-release/README.md`。

```text
/opt/lfclaw-enterprise/
  packages/                      # one uploaded archive per module update
    lfclaw-admin-<yyyyMMddxx>-linux-x64.tar.gz
    lfclaw-win-x64-<yyyyMMddxx>.tar.gz
    lfclaw-mac-arm64-<yyyyMMddxx>.tar.gz
  admin/
    live -> versions/<yyyyMMddxx>/
    versions/<yyyyMMddxx>/       # extracted runtime/ and web/
    config/runtime.json
    data/
      db.json
      admin-auth.json
      sessions.json
      dsh-home/                 # dedicated admin DSH_HOME
      connector-data/           # created when connectors need persistent state
      skills/                    # uploaded skill ZIP files
      session-shares/            # index.json and shared session JSON files
      backups/                   # created only when an admin backup runs
  desktop/                       # only when serving desktop updates
    dsh-desk/bin/<target>/       # installers, update files, blockmaps
    dsh-desk/feeds/<target>/     # update channel YAML
```

- `packages/` 是唯一的上传目录。管理端、Windows 和 Mac 安装包均以单文件归档存放；部署命令按模块前缀与合法发布编号选择最新文件，再核对清单、目标、大小和 SHA-512。归档有效不等于已经运行，不能只凭文件名通知客户端更新。
- `admin/` 是管理端模块。`versions/` 只留当前和上一个已验证的解包版本；部署时 `live` 临时指向候选版本，启动或健康检查失败则恢复上一版。管理员网页由 `live/web/` 提供，企业 API 由 `live/runtime/` 的独立 LFClaw 进程提供；将 `/lfclaw/api` 转发给该进程。
- `admin/config/runtime.json` 保存 bindHost、port、publicOrigin、dataDirectory；首次初始化成功后安装器移除 initialPassword。文件仅 root 和服务组可读，不通过 HTTP 提供，也不进入归档。
- `admin/data/db.json` 保存部门、员工、模型、技能、连接器、专家、个人专家、版本记录和操作记录等结构化数据；连接器账号及密钥、启动命令、参数、环境变量与外部专家配置也保存在这里。需要本机状态的连接器使用 `connector-data/`，或其显式配置的专用数据目录。不要另建 `experts/` 或 `connectors/` 文件夹来存放结构化记录，也不要把该文件作为公开的客户端 JSON。
- `admin/data/admin-auth.json` 保存管理员凭据，`sessions.json` 保存管理员和员工登录会话。`skills/<UUID>.zip` 是技能的实际附件，`db.json` 保存附件引用和历史版本；旧 ZIP 只有在确认不再被历史记录引用后才能清理。
- `admin/data/session-shares/index.json` 保存分享策略、索引和通知；同目录下的 `<UUID>.json` 保存分享的完整会话与附件，过期数据由服务端清理。`backups/<UUID>.zip` 是管理端手动备份文件，`db.json` 保存其记录；现有管理端下载备份不包含个人专家，服务器迁移须另外备份完整的 `db.json`、会话文件和分享文件。更新 `live` 不移动或重置 `data/`。
- `desktop/dsh-desk/bin/` 放公开安装与更新文件，`feeds/` 放更新清单；该层级对应当前客户端的 `/dsh-desk/bin/<target>/` 和 `/dsh-desk/feeds/<target>/` URL。Windows 自动更新使用 `.exe` 和 `.exe.blockmap`；Mac 手动安装使用 `.dmg`，自动更新使用 `.zip` 和 `.zip.blockmap`。通道清单只能在相应文件上传并验证后替换。若只部署管理端，不创建 `desktop/`。

Linux x64 管理端包需要 Node.js 24 或更高版本及 systemd。明确选择时支持 HTTP 直接访问管理端，传输不加密；桌面和本地人工测试统一使用配置的正式企业服务，HTTP 需要显式设置 allowInsecureHttp。服务端 stdio 连接器需要运行账户能找到对应命令，npx 还需要 npm/npx 和软件源网络访问。锁定连接器版本并由该账户逐个测试；账户 HOME 是 admin/data，npm 缓存也存于其中。客户端连接器另需在客户端准备依赖。日志由 journald 保存。

服务通过 LFCLAW_DATA_DIR 读取业务数据；run.mjs 将配置交给专用 profile。/healthz 返回产品、发布编号和就绪状态，对外仅提供管理员静态页面与企业 API。

管理端进程还须设置独立的 `DSH_HOME=/opt/lfclaw-enterprise/admin/data/dsh-home`，不得与同机其他 DSH 服务共用 profile、设置或会话。对外只开放管理页和 `/lfclaw/api`，不公开 DSH Web 的其他路径；启用前检查计划使用的监听端口和代理路径是否与其他服务冲突。

## 发布输入

每个版本、每个目标构建一个不可变归档。目标可以是一个桌面平台及架构，也可以是一个托管服务运行环境。归档内的清单包含产品、目标、版本、文件路径、字节数和 SHA-512；发布程序须在改变线上状态前验证每个条目。同一版本若重新构建出不同字节，必须拒绝发布并改用更高版本。不得向运行中的目录人工逐个复制文件。

桌面命令 `pnpm --dir apps/desktop run bundle:update -- <target>` 在目标打包完成后生成归档，COS 上传器仍逐个发布对象。管理端打包入口是 `LFClaw/08-构建运行/server-release/pack.mjs`；随包 deploy.mjs 校验归档，用临时数据测试启动，再启用独立 systemd 服务。

## 目录职责

桌面更新站点从 `packages/` 读取已验证的版本归档，将安装包放进 `desktop/dsh-desk/bin/<target>/`，通道清单放进 `desktop/dsh-desk/feeds/<target>/`，通过 HTTPS 提供。发布成功后执行两版保留规则；请求已删除版本的客户端须刷新更新清单。`desktop/` 不存放凭据或用户数据。

管理端服务从 `packages/` 读取已验证的归档，解包到 `admin/versions/<发布编号>/`，以 `admin/live` 选择实际运行版本。`admin/config/` 和 `admin/data/` 跨版本保留。日志交由选定的进程管理器或日志服务保存；发布归档不含持久数据或密钥。

管理端更新保留 admin/data 和操作人员配置，仅在首次成功初始化后移除初始密码。企业记录、登录会话、技能 ZIP、分享和备份均留在原位。部署器拒绝 dataSchema 变化；数据迁移须单独完成完整备份与兼容性检查。

员工客户端的会话保存在各自设备的 `$DSH_HOME`，不在服务器的 `desktop/` 或桌面安装目录。桌面更新只能替换应用和内置运行时，不得删除、移动或重置 `$DSH_HOME`、Electron 用户数据及员工选定的工作区；打包时保持应用身份和这些数据路径稳定。Windows 原地更新使用保留用户数据的卸载模式；用户主动卸载与更新是不同操作。服务器更新不能代替客户端本地会话备份。

## 发布顺序

操作人员运行一个按模块部署的命令，部署程序从 `packages/` 选择该模块编号最新的完整归档，先验证清单、签名策略、文件哈希、目标和严格递增的版本，再激活版本。对于桌面更新，先将安装包和 blockmap 发布到带版本的最终路径，验证公网可读取后，最后原子替换通道清单；中断上传不得让清单指向缺失的安装包。打包时写入的桌面更新地址必须与发布程序使用的公开源站一致。

对于管理端服务，部署程序先解包到 `admin/versions/<发布编号>/` 并验证配置，再切换 `admin/live`，随后通过明确指定的进程管理器启动或重启服务并执行健康检查。激活或健康检查失败时，恢复上一个版本指针及服务。若无法确认当前版本，须报告结果未知，由操作人员检查状态后再重试。激活过程不删除旧版本。

## 验证与回退

桌面发布验收须检查下载文件、更新清单、签名和更新后客户端会话。管理端部署检查 /healthz、管理员登录及原有企业记录。激活失败自动恢复上一版本，安装器不提供手动降级入口；激活成功后只保留当前和上一版程序及对应归档。deployment.json 记录当前与上一发布编号。

## 当前实现范围

管理端归档、专用启动器、校验器、安装器和健康接口已实现。健康检查同时要求正确的发布编号与企业 API 鉴权响应。桌面支持显式配置 HTTP 企业服务，Windows 归档发布使用 [LFClaw 发布工具](../../LFClaw/08-构建运行/desktop-release/pack.mjs)。macOS 签名发布需要 Apple 凭据和目标仓库。
