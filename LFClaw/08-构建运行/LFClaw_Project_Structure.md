# LFClaw 项目文件结构说明

> 作用：让 AI 和人类快速理解仓库中 LFClaw 相关文件的分布与归属。
> 维护规则：新增/移动/删除 LFClaw 相关文件时同步更新本文件。

---

## 1. 顶层目录

| 路径 | 说明 |
|------|------|
| `D:/deepseek-harness/AGENTS.md` | 仓库级 Agent 工作规范，适用于所有 packages/ 修改。 |
| `D:/deepseek-harness/docs/architecture.md` | DeepSeek Harness（DSH）架构说明。 |
| `D:/deepseek-harness/需求文档/` | 原始需求文档目录。 |
| `D:/deepseek-harness/LFClaw_UI_Complete_20_Images_Windows (1)/` | LFClaw UI 设计图（客户端 + 管理端）。 |

## 2. 需求与设计文档

| 路径 | 说明 |
|------|------|
| `需求文档/LFClaw_完整需求与技术可行性核查_V1.0.docx` | 原始需求文档（含 16 个功能模块）。 |
| `需求文档/LFClaw_需求_提取.txt` | 从 docx 提取的纯文本需求基线（便于 AI 读取）。 |
| `LFClaw_UI_Complete_20_Images_Windows (1)/01_Current/Admin/*.png` | 管理端当前 UI 图（总览、员工、模型等）。 |
| `LFClaw_UI_Complete_20_Images_Windows (1)/01_Current/Client/*.png` | 客户端当前 UI 图（首页、账号、技能等）。 |
| `LFClaw_UI_Complete_20_Images_Windows (1)/02_Earlier_Concepts/Admin/*.png` | 管理端早期概念图。 |
| `LFClaw_UI_Complete_20_Images_Windows (1)/02_Earlier_Concepts/Client/*.png` | 客户端早期概念图。 |
| `LFClaw_UI_Complete_20_Images_Windows (1)/README_CN.txt` | UI 图索引说明。 |
| `LFClaw_UI_Complete_20_Images_Windows (1)/image_index.csv` | UI 图索引表。 |

## 3. 产品/设计交付物

| 路径 | 说明 |
|------|------|
| `deliverables/software-company/LFClaw_PRD.md` | 产品经理许清楚产出的产品需求文档（PRD）。 |
| `deliverables/software-company/LFClaw_Architecture.md` | 架构师高见远产出的系统架构设计与任务分解。 |
| `deliverables/software-company/LFClaw_Project_Structure.md` | 本文档：项目文件分类说明。 |
| `deliverables/software-company/LFClaw_Change_Log.md` | 变更/贡献记录：谁做了什么。 |

## 4. 客户端代码（员工端）

> 落点：`packages/client/ui-lfclaw/`，作为 DSH 客户端插件运行。

| 路径 | 说明 |
|------|------|
| `packages/client/ui-lfclaw/package.json` | 插件 manifest，声明 client 注入与依赖。 |
| `packages/client/ui-lfclaw/src/client/index.ts` | 插件入口：注册 main panel 与 sidebar panellist。 |
| `packages/client/ui-lfclaw/src/client/LfclawPage.tsx` | 员工端壳组件，负责内层导航和子页渲染。 |
| `packages/client/ui-lfclaw/src/client/LfclawPage.module.css` | 壳组件样式。 |
| `packages/client/ui-lfclaw/src/client/LfclawIcon.tsx` | 侧边栏图标组件。 |
| `packages/client/ui-lfclaw/src/client/locales.ts` | 中英文文案。 |
| `packages/client/ui-lfclaw/src/client/stores.ts` | 员工端内部导航状态 store。 |
| `packages/client/ui-lfclaw/src/client/pages/*.tsx` | 员工端子页面（Home、Chat、Dashboard、Profile、Settings）。 |
| `packages/client/ui-lfclaw/src/client/mocks/employeeMock.ts` | 员工端 mock 数据。 |
| `packages/client/ui-lfclaw/preview/` | 独立 Vite 预览入口，用于直接预览员工端 UI。 |

## 5. 服务端代码（管理端）

> 落点：`apps/admin-web/`（包名 `@deepseek-ai/lfclaw-admin-web`）。

| 路径 | 说明 |
|------|------|
| `apps/admin-web/package.json` | 包 manifest，声明依赖与 scripts。 |
| `apps/admin-web/vite.config.ts` | Vite 构建配置。 |
| `apps/admin-web/tsconfig.json` | TypeScript 配置。 |
| `apps/admin-web/index.html` | 入口 HTML。 |
| `apps/admin-web/src/main.tsx` | React 渲染入口。 |
| `apps/admin-web/src/App.tsx` | 路由与认证状态。 |
| `apps/admin-web/src/index.css` | 全局样式与设计令牌。 |
| `apps/admin-web/src/mock/data.ts` | 管理端 mock 数据与工具函数。 |
| `apps/admin-web/src/hooks/useLocale.ts` | i18n Hook。 |
| `apps/admin-web/src/locales/zh.ts` | 中文文案。 |
| `apps/admin-web/src/locales/en.ts` | 英文文案。 |
| `apps/admin-web/src/locales/index.ts` | 类型导出与工具函数。 |
| `apps/admin-web/src/components/AdminLayout.tsx` | 管理端布局（左侧导航 + 顶部栏）。 |
| `apps/admin-web/src/components/StatCard.tsx` | 统计卡片组件。 |
| `apps/admin-web/src/components/DataTable.tsx` | 数据表格组件。 |
| `apps/admin-web/src/components/DetailDrawer.tsx` | 详情抽屉组件。 |
| `apps/admin-web/src/components/PageShell.tsx` | 页面外壳组件。 |
| `apps/admin-web/src/components/SimpleChart.tsx` | 简单图表组件。 |
| `apps/admin-web/src/pages/*.tsx` | 管理端各页面（Login、Dashboard、Departments、Employees、Models、Skills、Connectors、Experts、Notifications、Backup、Versions、SystemStatus）。 |

## 6. 共享基础设施

| 路径 | 说明 |
|------|------|
| `packages/client/ui-primitives/` | DSH 共享原子组件库（Button、Input、Tag、Switch 等）。 |
| `packages/client/ui-theme/src/styles/*.css` | DSH 设计令牌（`--dsw-*`）。 |
| `packages/client/ui-layout/` | DSH 三栏布局插件。 |
| `apps/web/` | DSH Web 应用构建入口（员工端浏览器形态依赖它）。 |
| `apps/desktop/` | DSH Electron 桌面壳（员工端桌面形态依赖它）。 |

## 7. 构建脚本

| 路径 | 说明 |
|------|------|
| `package.json` | 根 package.json，后续可增加 `dev:lfclaw-admin`、`build:lfclaw-admin` 等脚本。 |
| `pnpm-workspace.yaml` | pnpm workspace 配置（apps/* 已被包含）。 |

---

*最后更新：2026-10-14*
