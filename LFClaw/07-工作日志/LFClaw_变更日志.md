# LFClaw 变更与贡献记录

> 作用：记录谁在什么时间做了什么、为什么做，便于 AI 后续会话快速接管。
> 维护规则：每完成一次实质性工作（PRD、架构、代码、测试、文档）即追加一行；不记录临时搜索/失败尝试。

---

## 时间线

| 时间 | 角色 | 动作 | 产出文件/路径 | 说明 |
|------|------|------|---------------|------|
| 2026-10-14 | 产品经理（software-product-manager） | 基于需求文档与 20 张 UI 图产出简单 PRD | `deliverables/software-company/LFClaw_PRD.md` | 明确双端边界、需求池 P0/P1/P2、页面清单、核心交互流程。 |
| 2026-10-14 | 代码摸排（lfclaw-explorer） | 摸排仓库 apps/ 与 packages/client/ 结构 | 口头/消息汇报 | 确认员工端落点为 `packages/client/ui-lfclaw`，管理端建议新建独立 Web 应用，仓库使用 `ui-primitives` + CSS Modules。 |
| 2026-10-14 | 架构师（software-architect） | 输出系统架构设计与任务分解 V1.0 | `deliverables/software-company/LFClaw_Architecture.md`、`docs/class-diagram.mermaid`、`docs/sequence-diagram.mermaid` | 初版建议 MUI + Tailwind + 新建 `apps/lfclaw-client`。 |
| 2026-10-14 | 主理人（team-lead） | 审核并纠正架构方向 | `deliverables/software-company/LFClaw_Architecture.md`（V1.1 修订） | 决定员工端扩展 `packages/client/ui-lfclaw`，管理端使用 `ui-primitives` + CSS Modules，不使用 MUI/Tailwind。 |
| 2026-10-14 | 工程师（software-engineer） | 尝试实现管理端 `apps/admin-web` | `apps/admin-web/package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src/main.tsx`、`src/index.css`、`src/locales/*`、`src/hooks/useLocale.ts` | 完成骨架与 i18n 后因超时卡住，未产出页面组件。 |
| 2026-10-14 | 主理人（team-lead） | 接管管理端实现 | `apps/admin-web/src/App.tsx`、`src/mock/data.ts`、`src/components/AdminLayout.tsx`、`src/components/common/*.tsx`、`src/pages/LoginPage.tsx`、`src/pages/DashboardPage.tsx`、`src/pages/DepartmentsPage.tsx`、`src/pages/EmployeesPage.tsx` 等 | 继续实现管理端核心页面与组件。 |
| 2026-10-14 | 主理人（team-lead） | 创建项目结构与变更记录文档 | `deliverables/software-company/LFClaw_Project_Structure.md`、`deliverables/software-company/LFClaw_Change_Log.md` | 整理文件分类与贡献记录，便于 AI 后续读取。 |
| 2026-10-14 | 探索代理（lfclaw-explore） | 摸排 `packages/client/ui-lfclaw` 现状 | 消息汇报 | 确认员工端应扩展为“壳+子页”结构，使用内部 store 管理导航，复用 DSH Runtime。 |
| 2026-10-14 | 工程师（lfclaw-admin-builder） | 修复管理端 TypeScript 构建错误 | `apps/admin-web/src/App.tsx`、`src/locales/index.ts`、`src/mock/data.ts`、`src/pages/*.tsx`、`src/components/PageShell.tsx`、`vite.config.ts`、`src/index.css` 等 | 解决图标引用、import 路径、mock 命名、exactOptionalPropertyTypes 等错误，build/dev 均可通过。 |
| 2026-10-14 | 主理人（team-lead） | 启动管理端预览服务 | 后台任务 `J1aJHo` | `pnpm --filter @deepseek-ai/lfclaw-admin-web run dev` 已启动，监听 http://127.0.0.1:5173/。 |
| 2026-10-14 | 主理人（team-lead） | 派工程师实现员工端多页面与预览入口 | `packages/client/ui-lfclaw/src/client/pages/*.tsx`、`stores.ts`、`mocks/*.ts`、`preview/*`、`src/client/LfclawPage.tsx`、`locales.ts` | 扩展 Home/Chat/Dashboard/Profile/Settings 子页，新增独立 Vite 预览入口。 |

---

## 待完成工作

- [x] 管理端：完成剩余页面（Models、Skills、Connectors、Experts、Notifications、Backup、Versions、System）。
- [x] 管理端：运行 `pnpm install` / `pnpm --filter @deepseek-ai/lfclaw-admin-web run build` / `run dev` 验证。
- [ ] 员工端：扩展 `packages/client/ui-lfclaw` 多页面结构（Home、Chat、Dashboard、Profile、Settings）。
- [ ] 员工端：接入 mock 数据并创建独立预览入口。
- [ ] 双端：QA 验证与端到端走通。

---

## 关键决策

| 决策 | 决策者 | 时间 | 原因 |
|------|--------|------|------|
| 员工端扩展 `packages/client/ui-lfclaw` | team-lead | 2026-10-14 | 既有 DSH 插件已注册 sidebar/main panel，复用可保持与 DSH Runtime 集成。 |
| 管理端新建独立 Web 应用 | team-lead | 2026-10-14 | 管理后台需独立入口、独立认证，与员工端产品边界清晰。 |
| 不使用 MUI/Tailwind，改用 `ui-primitives` + CSS Modules | team-lead | 2026-10-14 | 代码摸排确认仓库实际规范，避免引入外部组件库破坏一致性。 |

---

*最后更新：2026-10-14*
