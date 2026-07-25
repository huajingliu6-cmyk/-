# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定基线**：阶段 3D-B6-C（一次性真实提交路径接线与零网络集成验证）开发完成态；父基线为 3D-B6-B `47b3fc5`。
- **页面入口**：`/`、`/login`、`/workflow`
- **本地启动**：

```bash
npm install
npm run dev
```

本机一次性测试演练（仍不自动开付费）可选用仅绑定环回地址：

```bash
npm run dev:local-paid-test
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
| `src/video-generation/local-paid-test` | 本机一次性付费测试闸门、Guard、Arm nonce、专用 submit、Origin 校验 |
| `src/video-generation/provider/wan27-*` | 契约常量、错误映射、响应 Schema、Readiness、Dry Run |
| `src/app/api/generations` | 异步生成 HTTP API（GET 含 readiness）；**不能**提交真实 Provider |
| `src/app/api/local-paid-test` | 状态 / Arm / Dry Run / Simulation / **Submit**（管理员） |
| `src/app/api/assets` | 本地资产；generatedVideo 支持 Range |
| `data/workflows` | WorkflowDocument JSON（开发） |
| `data/assets` / `data/generations` / `data/idempotency` / `data/paid-test-guard` / `data/generated-videos` / `data/mock` | 运行时数据（gitignore；仅 `.gitkeep` / README） |

**`data/` 只适合本地单机开发**，不适合多实例或无状态部署；生产需 OSS / 对象存储 + 共享幂等后端。

---

# 阶段 3D-B6-C（本阶段）

一次性真实提交路径接线与零网络集成验证（**未真实付费、未调阿里云；零网络测试**）。

要点：

1. 专用 API：`POST /api/local-paid-test/submit`（不可 GET / query / 页面加载触发）。
2. 统一策略 `assertPaidGenerationSubmissionPolicy`：普通 `POST /api/generations` **即使** `VIDEO_PROVIDER=aliyun-wan27` + `ALLOW_PAID_GENERATION=true` + `confirmPaidGeneration=true` 也拒绝真实提交（`PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE`）。
3. Loopback + Origin + Sec-Fetch-Site + 拒绝非本机 `Forwarded` / `X-Forwarded-*`。
4. Arm 返回一次性高熵 nonce；Guard **只存 SHA-256**；刷新页面丢失，需重新 Arm。
5. 相同 nonce + 相同 fingerprint 的重复提交返回已有 generation；不同 fingerprint 拒绝。
6. Guard ↔ 幂等 ↔ GenerationRecord 顺序已接线；`unknownOutcome` / `transferPending` 联动。
7. `retryGeneration` 在本机一次性模式永久拒绝；`retryTransfer` 允许。
8. `LocalPaidTestCard`：nonce 仅内存；默认 mock/false 下「确认一次付费测试」仍禁用。
9. 零网络集成测试使用注入假 Provider / 临时目录；**不产生费用**。
10. 默认仍：`VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`WAN_RESULT_ALLOWED_HOSTS` 空、`readyForPaidSubmission=false`。
11. Agent **永远不能**自动执行真实付费测试。
12. 详见 `docs/wan27-local-one-shot-test-gate.md`。

---

# 阶段 3D-B6-B（已完成）

本机一次性付费测试闸门与零费用 Simulation（**未真实付费、未调阿里云**）。

要点：Arm / Dry Run / Simulation、Guard 状态机、两级 Readiness。真实提交在 3D-B6-C 接线。

---

# 阶段 3D-B6-A / 3D-B1-A / 3D-B3 / 3D-A（已完成）

见既有文档：契约清单、持久幂等、SSRF 转存、Mock e2e。

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
- 阶段 3D-B6-B：本机一次性闸门、Guard、Arm、Simulation、本机环回脚本
- 阶段 3D-B6-C：专用 submit、Origin/CSRF、Arm nonce、防绕过策略、零网络集成

---

# 安全规则

- `VIDEO_PROVIDER` 默认 **`mock`**
- `ALLOW_PAID_GENERATION` 默认 **`false`**
- `WAN_RESULT_ALLOWED_HOSTS` 默认空（真实转存禁用直至配置）
- `WAN_LOCAL_PAID_TEST_MODE` 默认 **`false`**；Token / 价格确认 / 费用上限默认空
- 密钥与测试 Token 仅服务端；禁止 `NEXT_PUBLIC_` 暴露
- Arm nonce 只存哈希；原始 nonce 不进日志 / Guard / Generation / 幂等 / URL / LocalStorage
- 自动保存、metadata PATCH、页面刷新 **不会**自动 Arm / Dry Run / Simulation / 提交 generation
- `createVideoProvider` 硬分支；Aliyun **失败不回退** Mock
- 真实 Provider 提交必须经 `assertPaidGenerationSubmissionPolicy`；普通 generation API 禁止
- 禁止提交：视频、generation JSON、幂等运行时记录、Guard 运行时 JSON、用户素材、`.env.local`、密钥、nonce

---

# 当前验证结果

| 命令 | 预期 |
|------|------|
| `npm run lint` | 0 |
| `npx eslint . --max-warnings=0` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0；**≥247**（Vitest；0 failed / 0 skipped / 0 todo） |
| `npm run build` | 0 |

---

# 下一阶段

**人工真实测试前最终只读预检**（仅人工核对，非 Agent 付费执行）：确认默认仍为 mock / false、allowlist 策略、本机环回与清单项齐全后，再按 `docs/wan27-first-paid-test.md` 由人工决定是否做一次最低成本试跑。测完立即恢复 mock。

不要自动付费；不要 push；不要 eslint-disable / `any` / `@ts-ignore`。Agent 永远不能自动执行真实测试。

---

# 已知风险

- `data/` 仅本地开发；生产需对象存储
- 本地文件幂等 **仅单机器**；Windows unlink→rename 有短暂缺失窗口；多实例需 Postgres/Redis
- 浏览器 metadata 非服务端可信验证
- 转存锁仍为单进程 `transferInFlight`
- 真实 Provider 付费 e2e **尚未执行**
- 全局 Undo/Redo 未实现
- 权限非生产级多用户隔离
- 官方不保证固定结果域名；allowlist 为空时真实转存保持禁用
- T2V `audio_url` 当前未实现
- Guard 与幂等非跨文件事务；不一致时安全停止
- 生产仍缺：完整用户所有权、服务端限流与预算、数据库、对象存储、多实例共享幂等

---

# 相关文档

- `docs/wan27-local-one-shot-test-gate.md`
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

*文档对应阶段 3D-B6-C 完成态。*
