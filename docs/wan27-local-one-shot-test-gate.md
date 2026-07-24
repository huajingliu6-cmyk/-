# 本机一次性付费测试闸门（阶段 3D-B6-B）

严格受限、**默认关闭**、仅限本机 `development` 的一次性真实付费测试准备与零费用 Simulation。

**状态：3D-B6-B 已完成**（含零费用浏览器验收）。当前只支持 **Arm / Dry Run / Simulation**；真实提交路径**尚未接线**；「确认一次付费测试」**仍禁用**。

**本阶段不执行真实付费。** Agent / 测试 / 构建永远不得触发真实 Provider 请求。

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
- 脚本 `npm run dev:local-paid-test` 仅绑定 `127.0.0.1`（经 `next dev --help` 核对 `-H`），**不**设置密钥或付费开关

## 固定最低规格（闸门专用）

- 模式：textToVideo（纯文生）
- 720P · 16:9 · 2 秒
- 无首帧 / 无角色 / 场景 / 图片 / 视频 / 音频 / 音色参考
- 同时仅一个任务；禁止其他 active generation

服务端强制校验；不能靠前端或手改 JSON 绕过。不修改普通 `ModelCapability`，不影响 Mock。

## Guard 状态机

路径：`data/paid-test-guard/`（运行时 JSON gitignore；可跟踪 `.gitkeep` / README）

状态：`unarmed` → `armed` → `submitting` → `providerAccepted` → `transferPending` → `completed` / `consumed`

旁路：`failedBeforeSubmit`（可人工重新 Arm）、`unknownOutcome`（锁定）

规则摘要：

- 进入 `submitting` 后默认视为名额可能已消耗；超时不得自动回到 `armed`
- `unknownOutcome`：禁止重提；文案「提交结果无法确认，为避免重复计费，一次性测试已锁定。」
- `retryTransfer` 允许，不创建新任务、不消耗第二名额
- `retryGeneration` 在本机一次性模式永远禁止（`LOCAL_PAID_TEST_ALREADY_CONSUMED`）
- 刷新页面不自动改 Guard
- 单机器文件保护，**不是**生产预算 / 多实例系统；Windows unlink→rename 有短暂缺失窗口

Guard 文件禁止含：API Key、Token、Prompt、base64、视频/签名 URL、本机路径。

## Token 与确认短语

- 确认短语固定：`我已确认本次测试可能产生费用且只提交一次`
- Token：`crypto.timingSafeEqual`（先比长度）
- Token 不进日志 / Guard / GenerationRecord / 幂等 / API 响应
- 页面 password 输入，提交后清空；不进 LocalStorage / URL

## 人工价格确认

- `WAN_TEST_PRICE_CONFIRMED_ON` 必须等于服务端本地当天
- `WAN_TEST_MAX_COST_CNY` 为正数且 ≤ 硬上限 10
- 不硬编码模型单价；不查余额/账单
- UI：`费用上限来自管理员人工确认，最终费用以阿里云控制台结算为准。`

## 两级 Readiness

1. `buildWan27LocalPaidTestEnvironmentReadiness` — 环境
2. `validateWan27OneShotPaidRequest` — 具体请求规格与确认

默认 `readyForPaidSubmission=false`。本阶段实际运行环境保持 false。
测试仅可通过注入假环境使 `readyForOneShotLocalTest=true`。
Readiness 不联网、不改 Guard、不建 generation。

## allowlist 为空

- `readyForResultTransfer=false`
- 警告：可提交但转存会被阻止；人工审批 hostname 后 `retryTransfer`
- **不**关闭 SSRF

## 未来真实提交顺序（本阶段只用 Simulation 演练）

验证 Workflow → 规格 → Token/armed → 幂等 reserve → GenerationRecord → Guard submitting → Provider → providerAccepted → …

本阶段「确认一次付费测试」按钮**继续禁用**。

## Simulation

- 假 Provider / `sim-fake-task-*`
- 临时目录，不写正式 generation / 幂等 / 视频
- `simulation=true`；UI 不得当作真实成功
- 演练全状态机与重复提交 / retry 语义
- **不产生费用、不访问网络**

## 本机绑定要求（真实测试日文档）

单进程 · 仅 `127.0.0.1` · 无隧道 · 无局域网共享 · 单标签 · 管理员密码已改 · 测完恢复 `VIDEO_PROVIDER=mock` 与 `ALLOW_PAID_GENERATION=false`

## 归档 Guard

`markConsumed` 或删除 `data/paid-test-guard/*.json`（勿提交）。`failedBeforeSubmit` 可人工重新 Arm；`unknownOutcome` 需人工排查，禁止普通按钮清除。

## 生产仍缺

用户所有权、限流预算、数据库、对象存储、多实例共享幂等。

## 验证基线

- Vitest：**≥241**（Failed / Skipped / Todo = 0）
- 默认仍：`VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`WAN_RESULT_ALLOWED_HOSTS` 空、`readyForPaidSubmission=false`

## 下一阶段

接线一次性真实提交路径，但仍使用注入 Provider 做零网络验证；真实付费与真实阿里云调用继续禁止，直至人工清单全部完成。

文档不含真实 Token / 密钥 / Workspace / allowlist / 用户素材。
