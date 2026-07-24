# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定基线**：阶段 3D-B6-A（万相 2.7 官方契约复核 / Readiness / Dry Run）完成态；其前一提交为 3D-B1-A `bc79609`。
- **页面入口**：`/`、`/login`、`/workflow`
- **本地启动**：

```bash
npm install
npm run dev
```

> 写代码前查阅 `node_modules/next/dist/docs/` 与仓库 `AGENTS.md`。

---

# 当前架构

| 路径 | 职责 |
|------|------|
| `src/workflow` | React Flow 工作台 UI 与领域 |
| `src/video-generation` | Provider、生成任务、转存、参数对照、Range、metadata |
| `src/video-generation/idempotency` | 持久幂等接口、fingerprint、文件 store、对账 |
| `src/video-generation/secure-transfer` | 真实结果 SSRF 防护、TransferSource、安全下载、URL 脱敏 |
| `src/video-generation/provider/wan27-*` | 契约常量、错误映射、响应 Schema、Readiness、Dry Run |
| `src/app/api/generations` | 异步生成 HTTP API（GET 含 readiness） |
| `src/app/api/assets` | 本地资产；generatedVideo 支持 Range |
| `data/workflows` | WorkflowDocument JSON（开发） |
| `data/assets` / `data/generations` / `data/idempotency` / `data/generated-videos` / `data/mock` | 运行时数据（gitignore；仅 `.gitkeep` / README） |

**`data/` 只适合本地单机开发**，不适合多实例或无状态部署；生产需 OSS / 对象存储 + 共享幂等后端。

---

# 阶段 3D-B6-A（已完成）

万相 2.7 官方契约复核、配置就绪检查与首次最低成本试跑**准备**（未付费、未调真实接口）。

要点：

1. 官方文档核对日期 **2026-07-25**（文生/参考生 API、异步任务、错误码、模型价格）。
2. 契约清单：`docs/wan27-contract-checklist.md`（42 项矩阵）。
3. 错误映射：`mapWan27ProviderError`（中文用户提示；可保留 code / request_id）。
4. 响应 Schema：缺少 task_id / 非 JSON → 安全失败，不泄露响应体。
5. `buildWan27ProviderReadinessReport()`：不联网；**`readyForPaidSubmission` 恒为 false**。
6. `buildWan27DryRunPreview()`：脱敏摘要；不创建 generation / 幂等 / task。
7. 真实 Provider 轮询间隔对齐官方约 **15s**；Mock 仍约 3.5s。
8. 首次试跑文档：`docs/wan27-first-paid-test.md`（只文档，未执行）。
9. 价格不硬编码进业务代码；UI 文案固定为控制台为准。
10. 默认仍 `VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`WAN_RESULT_ALLOWED_HOSTS` 空。

---

# 阶段 3D-B1-A / 3D-B3 / 3D-A（已完成）

- 3D-B1-A：持久幂等、fingerprint、unknown outcome。见 `docs/generation-idempotency.md`。
- 3D-B3：SSRF 安全转存。见 `docs/secure-provider-result-transfer.md`。
- 3D-A：Mock e2e、防连点、转存幂等。

## Mock 不代表真实模型能力

Mock 只验证流程、播放、转存与参数记录。未调用阿里云、未付费。

## 全局 Undo/Redo

**尚未实现**；工具栏仍为占位。

---

# 已完成功能（摘要）

- React Flow 工作台、WorkflowDocument v4、自动保存（不触发生成）
- Mock / 万相 Provider 抽象；默认 mock；付费双门闩
- 阶段 3A–3C：可播放 Mock、参数对照、参考素材选择 UI
- 阶段 3D-A / 3D-B3 / 3D-B1-A：防连点、SSRF、持久幂等
- 阶段 3D-B6-A：官方契约复核、Readiness、Dry Run、错误映射、试跑文档

---

# 安全规则

- `VIDEO_PROVIDER` 默认 **`mock`**
- `ALLOW_PAID_GENERATION` 默认 **`false`**
- `WAN_RESULT_ALLOWED_HOSTS` 默认空（真实转存禁用直至配置）
- 密钥仅服务端；禁止 `NEXT_PUBLIC_` 暴露
- 自动保存、metadata PATCH、页面刷新 **不会**自动提交新 generation
- `createVideoProvider` 硬分支；Aliyun **失败不回退** Mock
- Readiness / Dry Run **不**开启真实 Provider、**不**联网
- 禁止提交：视频、generation JSON、幂等运行时记录、用户素材、`.env.local`、密钥

---

# 当前验证结果

| 命令 | 预期 |
|------|------|
| `npm run lint` | 0 |
| `npx eslint . --max-warnings=0` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0；**≥207**（Vitest；0 failed / 0 skipped / 0 todo） |
| `npm run build` | 0 |

---

# 下一阶段

**在明确解除 3D-B6-A 付费硬门闩之后**，方可按 `docs/wan27-first-paid-test.md` 做本机一次最低成本人工试跑。

不要自动付费；不要 push；不要 eslint-disable / `any` / `@ts-ignore`。

---

# 已知风险

- `data/` 仅本地开发；生产需对象存储
- 本地文件幂等 **仅单机器**；Windows unlink→rename 有短暂缺失窗口；多实例需 Postgres/Redis
- 浏览器 metadata 非服务端可信验证
- 转存锁仍为单进程 `transferInFlight`
- 真实 Provider 付费 e2e **尚未执行**（本阶段仅准备）
- 全局 Undo/Redo 未实现
- 权限非生产级多用户隔离
- 官方不保证固定结果域名；allowlist 为空时真实转存保持禁用
- T2V `audio_url` 当前未实现
- 生产仍缺：完整用户所有权、服务端限流与预算、数据库、对象存储、多实例共享幂等

---

# 相关文档

- `docs/wan27-contract-checklist.md`
- `docs/wan27-first-paid-test.md`
- `docs/generation-idempotency.md`
- `docs/mock-end-to-end-checklist.md`
- `docs/mock-video-setup.md`
- `docs/generation-parameter-comparison.md`
- `docs/reference-media-selection.md`
- `docs/video-provider-aliyun-wan27.md`
- `docs/secure-provider-result-transfer.md`
- `.env.example`

---

*文档对应阶段 3D-B6-A 完成态。*
