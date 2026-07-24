# 生成幂等与 Provider 提交保护（阶段 3D-B1-A）

本文说明持久化幂等、request fingerprint、unknown outcome、本地文件 backend 与 retry 语义。不含密钥、签名 URL 或用户素材。

**阶段状态：3D-B1-A 已完成。**

## 状态机

幂等记录 `IdempotencyRecord.state`：

| 状态 | 含义 |
|------|------|
| `reserved` | 已预留 key，尚未调用 Provider |
| `submitting` | 即将/正在调用 Provider |
| `providerAccepted` | Provider 已返回 `providerTaskId`（**优先**写入幂等记录） |
| `committed` | GenerationRecord 已写入 taskId |
| `safeFailure` | 明确在 Provider 接单前失败，允许同 key 同 fingerprint 重试 |
| `unknownOutcome` | 请求可能已发出但无法确认是否接单；**禁止**自动重试 |

提交顺序（Mock 与真实同一状态机）：

1. 构建并验证输入
2. 构建 fingerprint
3. `reserve`（Provider **前**）
4. 创建 GenerationRecord（Provider **前**）
5. `markSubmitting`（Provider **前**持久化）
6. 调用 Provider
7. `markProviderAccepted(providerTaskId)`（**先于** GenerationRecord）
8. 更新 GenerationRecord.providerTaskId
9. `markCommitted`

Provider 已调用后**不得**删除幂等记录（`releaseIfSafe` 仅允许 `reserved` / `safeFailure`）。

重复请求：

| 状态 | 同 key + 同 fingerprint |
|------|-------------------------|
| committed / providerAccepted | 返回已有 generation |
| reserved / submitting | 返回 in-progress，不调用 Provider |
| safeFailure | 允许按规则重新 reserve |
| unknownOutcome | 阻断，不调用 Provider |

同 key + 不同 fingerprint → `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`。

## request fingerprint

`buildGenerationRequestFingerprint()` 对规范化字段做**稳定键序 JSON** + SHA-256：

- projectId / shotNodeId / providerId / modelId
- generationInstruction 的 SHA-256（**不存正文**）
- resolution / aspectRatio / duration
- selectedReferenceAssetIds（**顺序有意义**）
- firstFrame assetId
- 关键导演参数、seed、watermark、promptExtend

不包含：API Key、confirmPaidGeneration、素材二进制、base64、签名 URL、本机路径。不使用 `Math.random`。

## unknown outcome

当请求已发送、网络超时或无法确认 Provider 是否接单、且没有 providerTaskId：

1. 标记 `unknownOutcome`
2. **不**自动再次提交 Provider
3. **不**自动释放 key
4. UI：`提交结果暂时无法确认，为避免重复计费，系统已暂停自动重试。`
5. 普通用户不能一键用同一请求再次付费提交
6. 重新生成必须使用**新 key**，并提示可能重复计费

Mock 可通过 `injectMockProviderUnknownOutcomeForTests()` 注入，不访问真实网络。

管理员入口：`POST /api/generations/[generationId]/reconcile`（只对账，**不**调用 Provider；**不能**把 unknownOutcome 改成 safeFailure）。

## taskId 保存与 reconcile

1. Provider 返回后先 `markProviderAccepted(providerTaskId)`
2. 再写 GenerationRecord.providerTaskId
3. GenerationRecord 更新失败时幂等记录仍保留 taskId，后续 reconcile 可补写
4. reconcile **永不**重新调用 Provider
5. 长时间 `submitting` 且无 taskId → `unknownOutcome`
6. `providerTaskId` 不进入 WorkflowDocument；客户端不能提交 taskId

## 本地文件 backend 与 Windows 替换保证

- 路径：`data/idempotency/`（gitignore；仅跟踪 `.gitkeep` / README）
- 实现：`FileGenerationIdempotencyStore`
- 文件名：`sha256(scope + "\0" + key).json`（key **不**作路径；防穿越）
- 预留：同目录 `flag: "wx"` 独占创建（同机并发仅一个成功）
- 保留期：默认 **7 天**（**不会**在 8 秒后删除）
- submitting 过期阈值：默认 **5 分钟**（对账为 unknown 或补写 accepted）
- `submitting` / `providerAccepted` / `unknownOutcome` **不会**被当成可安全过期清空后重放

### 写入替换：如实说明（不是数据库事务）

**临时文件与目标在同一目录**；临时名由服务端生成（`pid` + `uuid` + `.tmp`），用户不可控。`fs.writeFile` 写完后关闭句柄，再 `rename`。

| 场景 | 行为 |
|------|------|
| 目标不存在 | 同目录 `rename(tmp → target)`，通常可视为原子替换 |
| 目标已存在（尤其 Windows） | `rename` 覆盖常失败（`EPERM`/`EEXIST`）→ **先 `unlink(target)`，再 `rename(tmp → target)`** |

因此在「目标已存在」路径上：

- **存在短暂文件缺失窗口**（旧文件已删、新文件尚未 rename）
- **不是**严格事务原子替换，**不等于**数据库 `UPDATE` / 唯一约束
- **无** backup/rollback 文件；崩溃恢复依赖：
  - 写一半的 `.tmp`：残留垃圾，可读主文件仍是旧内容（若尚未 unlink）
  - 写完未 rename：主文件仍旧；tmp 可清理
  - 已 unlink 未 rename：主文件暂时缺失 → `get` 返回 `null`（**残余风险**：可能被误判为无记录；生产必须用共享 DB）
  - rename 完成：新内容可见

损坏 JSON：**不得**当作「不存在」。单条 `get` / `parseIdempotencyRecord` 返回 `IDEMPOTENCY_RECORD_CORRUPTED`，禁止因此盲目重调 Provider。

**本地文件方案 ≠ 数据库事务。** 仅适合单机器共享文件系统本地开发；**不**支持多机器、多实例或 Vercel Serverless。多实例须 Postgres/Redis 唯一约束。

## retryGeneration vs retryTransfer

| | retryGeneration | retryTransfer |
|--|-----------------|---------------|
| Provider | 调用（新任务） | **不**调用 |
| generationId | 新 | 不变 |
| idempotencyKey | **必须新键** | 不涉及 |
| 费用 | 可能产生新费用 | 无新付费任务 |
| 确认 | 仍要求 `confirmPaidGeneration` 门闩 | 仅转存 |
| 输入 | 最新 Workflow / 最新素材选择 | 沿用已有 remote |

unknownOutcome 下不能自动 retryGeneration；须新 key +（若适用）`acknowledgePossibleDuplicateCharge`。旧任务记录保留。

## 同镜头并发

同一 `projectId + shotNodeId + providerId` 存在 active 任务时阻止第二单（含多标签不同 key）。
active：`validating` / `submitting` / `queued` / `processing` / `downloading` / `unknownOutcome`。
`completed` / `failed` / `cancelled` 后可按规则新建。
本阶段不开放管理员强制并行。**仍是单机器级保护。**

## 错误码

- `IDEMPOTENCY_IN_PROGRESS`
- `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`
- `GENERATION_SUBMISSION_UNKNOWN`
- `ACTIVE_GENERATION_ALREADY_EXISTS`
- `IDEMPOTENCY_RECORD_CORRUPTED`
- `IDEMPOTENCY_STORE_UNAVAILABLE`

中文文案不暴露内部路径或密钥。

## 真实付费前剩余风险

- 多实例仍需 Postgres/Redis 唯一约束或共享锁
- Windows unlink→rename 短暂缺失窗口
- 本地文件锁 ≠ 数据库唯一约束
- 完整用户所有权 / IDOR 防护未完成
- 服务端限流与预算未完成
- 真实 Provider 付费 e2e 尚未执行（3D-B6-A 仅完成契约复核与试跑准备）
- DNS rebinding 等转存残余风险见 `docs/secure-provider-result-transfer.md`

**仍不允许**日常将 `ALLOW_PAID_GENERATION=true`。默认 `VIDEO_PROVIDER=mock`。
阶段 3D-B6-A：`readyForPaidSubmission` 恒为 false。

## 测试

以 `npm test`（Vitest）为准；阶段 3D-B6-A 起不少于 **207** 项（含契约 / Readiness / Dry Run 增量）。

## 下一阶段

**本机一次最低成本人工试跑**（见 `docs/wan27-first-paid-test.md`），须先明确解除付费硬门闩。
不要自动付费，不调用阿里云（除非人工执行清单）。
