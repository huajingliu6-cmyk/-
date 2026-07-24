# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定基线**：阶段 3D-B1-A（持久幂等）完成后以 `git log -1` 为准；其前一提交为 3D-B3 SSRF `3db6d3a`。
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
| `src/app/api/generations` | 异步生成 HTTP API |
| `src/app/api/assets` | 本地资产；generatedVideo 支持 Range |
| `data/workflows` | WorkflowDocument JSON（开发） |
| `data/assets` / `data/generations` / `data/idempotency` / `data/generated-videos` / `data/mock` | 运行时数据（gitignore；仅 `.gitkeep` / README） |

**`data/` 只适合本地单机开发**，不适合多实例或无状态部署；生产需 OSS / 对象存储 + 共享幂等后端。

---

# 阶段 3D-B1-A（已完成）

持久化幂等、Provider 提交日志与未知结果保护。

要点：

1. `GenerationIdempotencyStore` 接口；本地 `FileGenerationIdempotencyStore`（`data/idempotency/`）。
2. 状态机：`reserved → submitting → providerAccepted → committed`；旁路 `safeFailure` / `unknownOutcome`。
3. `buildGenerationRequestFingerprint()`：稳定规范化 + SHA-256（不含明文 prompt / 密钥 / base64 / 签名 URL）。
4. 提交顺序：reserve → GenerationRecord → markSubmitting → Provider → **先** markProviderAccepted(taskId) → 更新 GenerationRecord → markCommitted。
5. GenerationRecord 缺 taskId 时可 reconcile 补写；**永不**在对账中重调 Provider。
6. `unknownOutcome`：不自动重试、不释放 key；UI 阻断文案；Mock 可注入。
7. `retryGeneration`（新 key / 可能新费用）与 `retryTransfer`（不调 Provider）分离。
8. 同镜头 active 任务默认阻止第二单（多标签不同 key）。
9. Windows：目标已存在时为 unlink→rename，**有短暂缺失窗口**，**不是** DB 事务原子；详见 `docs/generation-idempotency.md`。
10. **不宣称**多机器并发安全；文件锁 ≠ DB 唯一约束。
11. 未接真实 Provider；默认仍 `mock` + `ALLOW_PAID_GENERATION=false`。

详见：`docs/generation-idempotency.md`。

---

# 阶段 3D-A / 3D-B3（已完成）

- 3D-A：Mock e2e、防连点、转存幂等、completed 收口（原进程内 8s Map 已被 3D-B1-A 持久化取代）。
- 3D-B3：真实结果 SSRF 防护；详见 `docs/secure-provider-result-transfer.md`。

## Mock 不代表真实模型能力

Mock 只验证流程、播放、转存与参数记录。未调用阿里云、未付费。

## 全局 Undo/Redo

**尚未实现**；工具栏仍为占位。

---

# 已完成功能（摘要）

- React Flow 工作台、WorkflowDocument v4、自动保存（不触发生成）
- Mock / 万相 Provider 抽象；默认 mock；付费双门闩
- 阶段 3A–3C：可播放 Mock、参数对照、参考素材选择 UI
- 阶段 3D-A：防连点 / 转存幂等 / completed 收口 / e2e
- 阶段 3D-B3：SSRF 安全转存、域名白名单、URL 脱敏
- 阶段 3D-B1-A：持久幂等、fingerprint、unknown outcome、同镜头并发保护

---

# 安全规则

- `VIDEO_PROVIDER` 默认 **`mock`**
- `ALLOW_PAID_GENERATION` 默认 **`false`**
- `WAN_RESULT_ALLOWED_HOSTS` 默认空（真实转存禁用直至配置）
- 密钥仅服务端；禁止 `NEXT_PUBLIC_` 暴露
- 自动保存、metadata PATCH、页面刷新 **不会**自动提交新 generation
- `createVideoProvider` 硬分支；Aliyun **失败不回退** Mock
- 禁止提交：视频、generation JSON、幂等运行时记录、用户素材、`.env.local`、密钥

---

# 当前验证结果

| 命令 | 预期 |
|------|------|
| `npm run lint` | 0 |
| `npx eslint . --max-warnings=0` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0；**207** 项（Vitest；0 failed / 0 skipped / 0 todo） |
| `npm run build` | 0 |

---

# 下一阶段

**Provider 官方契约复核与最低成本试跑准备**

不要自动付费；不要 push；不要 eslint-disable / `any` / `@ts-ignore`。

---

# 已知风险

- `data/` 仅本地开发；生产需对象存储
- 本地文件幂等 **仅单机器**；Windows unlink→rename 有短暂缺失窗口；多实例需 Postgres/Redis
- 浏览器 metadata 非服务端可信验证
- 转存锁仍为单进程 `transferInFlight`
- 真实 Provider 尚未付费 e2e
- 全局 Undo/Redo 未实现
- 权限非生产级多用户隔离（缺少完整 userId 所有权时，签名 URL 即使脱敏仍须防 IDOR）
- 官方不保证固定结果域名；allowlist 为空时真实转存保持禁用
- custom lookup 降低但未宣称消除全部 DNS rebinding 理论风险

---

# 相关文档

- `docs/generation-idempotency.md`
- `docs/mock-end-to-end-checklist.md`
- `docs/mock-video-setup.md`
- `docs/generation-parameter-comparison.md`
- `docs/reference-media-selection.md`
- `docs/video-provider-aliyun-wan27.md`
- `docs/secure-provider-result-transfer.md`
- `.env.example`

---

*文档对应阶段 3D-B1-A 完成态。*
