# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定基线**：阶段 3D-A 为 `60e6935`；阶段 3D-B3（SSRF 安全转存）完成后以 `git log -1` 为准。
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
| `src/video-generation/secure-transfer` | 真实结果 SSRF 防护、TransferSource、安全下载、URL 脱敏 |
| `src/app/api/generations` | 异步生成 HTTP API |
| `src/app/api/assets` | 本地资产；generatedVideo 支持 Range |
| `data/workflows` | WorkflowDocument JSON（开发） |
| `data/assets` / `data/generations` / `data/generated-videos` / `data/mock` | 运行时数据（gitignore；仅 `.gitkeep` / README） |

**`data/` 只适合本地单机开发**，不适合多实例或无状态部署；生产需 OSS / 对象存储。

---

# 阶段 3D-A（已完成）

Mock 完整端到端验收、故障恢复加固与浏览器人工验收 **已通过**。

## 本阶段实现要点

1. **前端同步提交锁**：`VideoPromptPanel` 使用 `submittingRef`（同步）+ `submitting` state；确认抽屉在 `submitting` 时禁用按钮。不依赖下一次 render 的 disabled。
2. **稳定幂等键**：打开确认 / 明确重试时用 `crypto.randomUUID()`（非 `Math.random` / 非每次点击 `Date.now()`）。同会话连点共用一键；成功受理或业务失败后释放；纯网络异常保留键以便短时重试。
3. **服务端幂等**：`rememberIdempotencyKey` 在调用 Provider **之前**登记；相同键不创建第二条 GenerationRecord / 不二次提交 Provider。
4. **转存幂等**：`retryTransferGeneration`；已有合法 `generatedVideo` 不重复复制；轮询与手动 transfer 共用单进程 `transferInFlight` 锁。
5. **completed 条件**：须同时具备 `localVideoAssetId`、`resultAsset`、id 一致、`assetType=generatedVideo`、MIME∈允许集、`sizeBytes>0`；否则不伪装 completed。
6. **自动化**：`src/video-generation/__tests__/mock-e2e-service.test.ts`
7. **人工清单**：`docs/mock-end-to-end-checklist.md`（浏览器验收已通过）

## 幂等存储限制（重要）

- 当前幂等为 **进程内 Map，约 8 秒窗口**。
- **仅适用于单实例本地开发**。
- **不是**生产级防重复计费保护。
- 多实例生产必须改为数据库或 Redis 等 **持久共享幂等记录**；转存并发亦需共享锁或唯一约束。单进程 `transferInFlight` **不能**解决多实例竞争。

## Mock 不代表真实模型能力

Mock 只验证流程、播放、转存与参数记录；`overallStatus=mockOnly`。未调用阿里云、未付费。

## 全局 Undo/Redo

**尚未实现**；工具栏仍为占位。

---

# 已完成功能（摘要）

- React Flow 工作台、WorkflowDocument v4、自动保存（不触发生成）
- Mock / 万相 Provider 抽象；默认 mock；付费双门闩
- 阶段 3A–3C：可播放 Mock、参数对照、参考素材选择 UI
- 阶段 3D-A：幂等 / 防连点 / 转存幂等 / completed 收口 / e2e 测试 / 人工验收
- 阶段 3D-B3：真实结果 SSRF 防护、域名白名单、Mock/Provider 转存隔离、客户端 URL 脱敏

---

# 阶段 3D-B3（已完成）

真实 Provider 结果安全转存与 SSRF 防护 **已完成**。未开启付费，未调用阿里云。

要点：

1. `TransferSource`：`mockFile` vs `providerHttps`，由 GenerationRecord 派生。
2. `WAN_RESULT_ALLOWED_HOSTS` 默认空 → 真实转存阻止。
3. HTTPS-only、私网/保留 IP 拦截、手动重定向、custom lookup DNS。
4. 流式下载、200MB、超时、ftyp、失败清理临时文件。
5. 客户端 API 不返回完整 `remoteVideoUrl`（`hasRemoteVideo` + 脱敏摘要）。
6. 详见 `docs/secure-provider-result-transfer.md`。

官方文档不保证固定 OSS 结果域名；白名单须管理员在首次人工确认后配置。

**浏览器 Mock 回归已通过**：生成 / 转存 / 播放 / 下载 / Range / metadata / 参数对照正常；`file://` 分支未被破坏；API 不暴露完整签名 URL；无阿里云与付费请求。

**仍不允许**设置 `ALLOW_PAID_GENERATION=true`（缺持久幂等、完整所有权、限流预算等）。

---

# 安全规则

- `VIDEO_PROVIDER` 默认 **`mock`**
- `ALLOW_PAID_GENERATION` 默认 **`false`**
- `WAN_RESULT_ALLOWED_HOSTS` 默认空（真实转存禁用直至配置）
- 密钥仅服务端；禁止 `NEXT_PUBLIC_` 暴露
- 自动保存、metadata PATCH、页面刷新 **不会**自动提交新 generation
- `createVideoProvider` 硬分支；Aliyun **失败不回退** Mock
- 禁止提交：视频、generation JSON、用户素材、`.env.local`、密钥

---

# 当前验证结果

| 命令 | 预期 |
|------|------|
| `npm run lint` | 0 |
| `npx eslint . --max-warnings=0` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0；**186** 项（Vitest 为准；0 failed / 0 skipped / 0 todo） |
| `npm run build` | 0 |

浏览器人工验收（3D-A Mock 全流程 + 3D-B3 Mock 回归）：**已通过**。

---

# 下一阶段

**持久幂等与 Provider 任务原子性（3D-B1）**

不要自动付费；不要 push；不要 eslint-disable / `any` / `@ts-ignore`。

---

# 已知风险

- `data/` 仅本地开发；生产需对象存储
- 浏览器 metadata 非服务端可信验证
- 进程内幂等 Map / 转存锁非多实例方案
- 真实 Provider 尚未付费 e2e
- 全局 Undo/Redo 未实现
- 权限非生产级多用户隔离（缺少完整 userId 所有权时，签名 URL 即使脱敏仍须防 IDOR）
- 官方不保证固定结果域名；allowlist 为空时真实转存保持禁用
- custom lookup 降低但未宣称消除全部 DNS rebinding 理论风险

---

# 相关文档

- `docs/mock-end-to-end-checklist.md`
- `docs/mock-video-setup.md`
- `docs/generation-parameter-comparison.md`
- `docs/reference-media-selection.md`
- `docs/video-provider-aliyun-wan27.md`
- `docs/secure-provider-result-transfer.md`
- `.env.example`

---

*文档对应阶段 3D-B3 完成态。*
