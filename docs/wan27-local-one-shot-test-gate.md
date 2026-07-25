# 本机一次性付费测试闸门（阶段 3D-B6-C）

严格受限、**默认关闭**、仅限本机 `development` 的一次性真实付费测试准备与提交路径。

**状态：3D-B6-C 已完成接线与零网络验证。** 专用 submit 已实现；普通 generation API 无法绕过；默认 mock / false 下仍禁止真实调用；「确认一次付费测试」仅在 readiness + Arm nonce 通过时可点。

**本阶段自动化不执行真实付费。** Agent / 测试 / 构建永远不得触发真实 Provider 请求。

---

## 默认关闭

| 变量 | 默认 | 说明 |
|---|---|---|
| `WAN_LOCAL_PAID_TEST_MODE` | `false` | 总开关 |
| `WAN_LOCAL_PAID_TEST_TOKEN` | 空 | 仅服务端；禁止 `NEXT_PUBLIC_` |
| `WAN_TEST_PRICE_CONFIRMED_ON` | 空 | `YYYY-MM-DD`，须为服务端本地当天 |
| `WAN_TEST_MAX_COST_CNY` | 空 | 人工费用上限；硬天花板 ≤ 10 元 |
| `WAN_TEST_MAX_TASKS` | `1` | 第一版只允许 1 |

不可通过 query / LocalStorage / 客户端改写开启。

## 仅允许 development

同时需要：`NODE_ENV=development` 且 `WAN_LOCAL_PAID_TEST_MODE=true`。

- `production` 永远拒绝（`LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION`）
- `test` 只能 Simulation / 注入，禁止真实联网闸门
- 脚本 `npm run dev:local-paid-test` 仅绑定 `127.0.0.1`，**不**设置密钥或付费开关

## 专用提交 API

`POST /api/local-paid-test/submit`

- 管理员 + development + 本机模式 + **环回 Host** + **同源 Origin** + Token + 确认短语 + Arm nonce + Guard=armed
- 拒绝 GET、query、页面加载、自动保存、Dry Run、Simulation 触发
- 客户端只能提交：`projectId` / `shotNodeId` / `confirmPaidGeneration` / Token / 确认短语 / Arm nonce / 幂等键
- 禁止客户端指定：Provider ID、Endpoint、模型 ID、`remoteVideoUrl`、`providerTaskId`
- 服务端从最新 WorkflowDocument 构建 input，并强制最低规格

确认短语：`我已确认本次测试可能产生费用且只提交一次`

## Loopback / Origin / CSRF

`validateLocalPaidTestRequestOrigin()`：

- Host：`127.0.0.1` / `localhost`（含端口）
- Origin 必须存在且与 Host 同 hostname/端口；拒绝 `null` / `file://` / 公网 / 局域网 / `0.0.0.0`
- `Sec-Fetch-Site` 若存在须为 `same-origin`
- 拒绝带非本机代理痕迹的 `Forwarded` / `X-Forwarded-*`（不信任客户端转发头）
- 错误信息不回显完整恶意 Header

错误码：`LOCAL_PAID_TEST_LOOPBACK_REQUIRED` / `LOCAL_PAID_TEST_ORIGIN_INVALID` / `LOCAL_PAID_TEST_CSRF_REJECTED` / `LOCAL_PAID_TEST_PROXY_NOT_ALLOWED`

## Arm nonce

- Arm 成功生成高熵 nonce，**仅在响应中返回一次**
- Guard 只存 `armNonceHash`（SHA-256）；不存原文
- 不进日志 / URL / LocalStorage / SessionStorage / GenerationRecord / 幂等 / WorkflowDocument
- 前端仅 React 内存；刷新丢失 → 重新输入 Token/短语并 Arm
- 已 armed 且未提交时可轮换 nonce（旧立即失效）
- 恒定时间哈希比较；离开 armed 后不能用旧 nonce 创建新任务

错误码：`LOCAL_PAID_TEST_NONCE_REQUIRED` / `INVALID` / `REUSED` / `LOCAL_PAID_TEST_REQUEST_MISMATCH`

重放语义：相同 nonce + 相同 fingerprint → 返回已有 generation / in-progress；不同 fingerprint → 拒绝。

## 普通 API 防绕过

`assertPaidGenerationSubmissionPolicy`：

| source | 行为 |
|---|---|
| `normalGenerationApi` | 真实 Provider 一律拒绝（`PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE`） |
| `retryGeneration` | 本机一次性模式或真实 Provider → 拒绝 |
| `localOneShotPaidTest` | 仅专用 submit 路径 |

Mock 普通 generation 不受影响。客户端按钮禁用不是唯一保护。

## 固定最低规格（闸门专用）

- 模式：textToVideo（纯文生）
- 720P · 16:9 · 2 秒
- 无首帧 / 无角色 / 场景 / 图片 / 视频 / 音频 / 音色参考
- 同时仅一个任务；禁止其他 active generation

## Guard 状态机

路径：`data/paid-test-guard/`（运行时 JSON gitignore）

状态：`unarmed` → `armed` → `submitting` → `providerAccepted` → `transferPending` → `completed` / `consumed`

旁路：`failedBeforeSubmit`（可重新 Arm）、`unknownOutcome`（锁定）

字段可含：`armNonceHash`、`armedAt`、`generationId`、`providerTaskId`、`lastErrorCode`、`requestFingerprint`

## 提交顺序

1. 验证管理员与本机来源
2. 加载最新 Workflow
3. 验证最低规格
4. Token / 确认短语 / nonce
5. Guard=armed
6. fingerprint
7. 幂等 reserve
8. GenerationRecord（`localOneShotPaidTest=true`）
9. Guard → submitting
10. 幂等 → submitting
11. Provider
12. 幂等 providerAccepted（先写 taskId）
13. Guard providerAccepted
14. GenerationRecord.providerTaskId
15. 幂等 committed

Provider 前失败 → `safeFailure` + `failedBeforeSubmit`。不确定结果 → 双方 `unknownOutcome`（禁止自动重试）。Provider 后绝不回到 `armed`。

## 轮询与转存联动

- 排队/生成中：Guard 保持 `providerAccepted`
- Provider FAILED / CANCELED → Guard `consumed`
- Provider UNKNOWN → `unknownOutcome`
- SUCCEEDED 但 allowlist 空 → generation 转存失败 + Guard `transferPending`
- `retryTransfer`：不调 Provider、不第二名额；成功 → `completed`
- 多次轮询不重复提交 Provider

## retry

- `retryGeneration`：本机一次性模式永远拒绝
- `retryTransfer`：允许；allowlist 未配置继续阻止

## Simulation（仍可用）

零费用假 Provider / 临时目录；不写正式 generation / 幂等 / 视频。

## UI

- Arm 后 nonce 存组件内存；提交前再次输入 Token + 确认短语
- Token 为 password；提交后清空 Token / 短语 / nonce
- 「确认一次付费测试」仅 readiness 通过且持有 nonce 时可点
- 默认 mock/false 继续禁用
- 文案：「该操作未来会创建一个可能产生费用的真实任务。」
- `unknownOutcome` 强阻断；`transferPending` 只显示重试转存

## 生产仍缺

用户所有权、限流预算、数据库、对象存储、多实例共享幂等。

## 验证基线

- Vitest：**≥247**（Failed / Skipped / Todo = 0）
- 零网络浏览器回归已通过（Arm nonce 内存、刷新重 Arm、错误拒绝、默认按钮禁用、Mock 不受影响）
- 默认仍：`VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`WAN_RESULT_ALLOWED_HOSTS` 空、`readyForPaidSubmission=false`
- 全部自动化测试使用假 Provider，零网络；本阶段没有产生费用

## 下一阶段

**人工真实测试前最终只读预检**，再决定是否按 `docs/wan27-first-paid-test.md` 做本机一次最低成本人工试跑。Agent 不得自动执行。

文档不含真实 Token / 密钥 / nonce / Workspace / allowlist / 用户素材。
