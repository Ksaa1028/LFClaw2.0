# WeKnora HTTP 接入

## 目标

管理端直接接受 WeKnora 提供的 HTTP API 基础地址，无需额外确认开关。

## 修改

- 管理端表单接受 HTTP 与 HTTPS 地址，移除 HTTP 确认开关，保留明文传输提示。
- 企业服务保存和调用 WeKnora 专家时接受 HTTP 与 HTTPS 地址，仍拒绝内嵌凭据、查询参数、片段和非 `/api/v1` 路径。
- 更新管理端与服务端说明、表单和接口测试。旧记录中的 `allowInsecureHttp` 字段不影响读取，新保存的配置不再写入该字段。

## 验证

- `pnpm --dir LFClaw/02-管理端/server exec tsx --test tests/weknora.test.ts tests/server.test.ts`：6 项通过。
- `pnpm exec vitest run --config LFClaw/02-管理端/admin-web/vitest.config.ts LFClaw/02-管理端/admin-web/tests/experts.spec.tsx`：7 项通过。
- 管理端与服务端各自的 `typecheck` 通过；本机 LFClaw 服务已重启。
- 未携带密钥访问 `http://8.216.38.213:8089/api/v1` 返回 HTTP 401，表明该地址可达但需要认证。未使用真实空间密钥执行对话测试。

## 使用限制

HTTP 会明文传输空间 API Key。管理员保存后可用专家卡片的“测试专家”验证该 Key 与 Agent ID 是否有效。
