# 万相 2.7 首次最低成本人工测试清单

**阶段**：3D-B6-A 编写本文档；**3D-B6-B** 已实现本机闸门 / Arm / Simulation（零费用浏览器验收已通过）。**仍不执行**真实付费。
**核对日期参考**：2026-07-25（测试当天必须重新确认价格与模型 ID）。

本清单**只描述人工操作**，不自动执行。完成后立即恢复 mock。

配套闸门实现见 `docs/wan27-local-one-shot-test-gate.md`（默认关闭；真实提交路径尚未接线；确认按钮仍禁用；仅 Arm / Dry Run / Simulation）。

**不允许 Agent 自动执行付费测试。** 不允许把真实密钥、Workspace ID 或 allowlist 写入本文档或仓库。

---

## 硬性禁止（Agent / 自动化）

- 不自动填写 `DASHSCOPE_API_KEY`
- 不修改仓库内 `.env.local` 并提交
- 不把 `VIDEO_PROVIDER` / `ALLOW_PAID_GENERATION` 的变更提交进 Git
- 不调用 `retryGeneration`（**可能产生新的付费任务与费用**）
- `retryTransfer` **不会**产生新的生成费用（仅转存已有远程结果）
- 不关闭 SSRF，不允许 `WAN_RESULT_ALLOWED_HOSTS=*`
- **禁止 Agent 自动切换 Provider 或开启付费**

---

## 测试当天重新确认

| # | 确认项 | 备注 |
|---|---|---|
| 1 | 当前模型 ID | 控制台 / 官方文档是否仍为 `wan2.7-t2v-2026-06-12` |
| 2 | 当前官方价格 | 打开「模型价格」页；北京 720P 曾为 0.6 元/秒（**可能已变**） |
| 3 | 免费额度 | 控制台「免费额度」；北京曾有 50 秒说明 |
| 4 | 账户余额 | 费用中心；避免欠费 Arrearage |
| 5 | Region 与 Workspace | API Key、Workspace、Endpoint 必须同一地域（建议北京） |
| 6 | 当前 result allowlist | 首次成功前可为空；见下方审批流程 |
| 7 | 预计最大费用 | 例如 720P×2s；写明上限并人工签字确认 |
| 8 | Git 工作区干净 | `git status` 无意外改动 |
| 9 | 仅一个开发服务器 | 单一 `npm run dev`（本机单进程） |
| 10 | 仅一个浏览器标签 | 单一操作者、单一标签页 |
| 11 | 测试后恢复 | `VIDEO_PROVIDER=mock` 且 `ALLOW_PAID_GENERATION=false` |

---

## 建议参数（最低成本）

| 项 | 值 |
|---|---|
| 环境 | 本机单进程 · 单一操作者 · 单一标签页 |
| 模式 | 纯 T2V（文生视频） |
| 参考素材 | **无**（不连接角色/场景；无参考视频；无音频；无首帧） |
| 分辨率 | `720P`（官方允许的较低档） |
| 比例 | `16:9` |
| 时长 | `2` 秒（当前官方允许的最短时长） |
| 水印 | `false`（可选） |
| prompt_extend | 可保持默认 |
| 任务数 | **仅 1 条** |
| retryGeneration | **不调用**（可能产生新费用） |
| retryTransfer | 仅在转存失败且远程 URL 仍有效时使用（**无新生成费用**） |
| 并行任务 | **无** |

UI 费用文案固定为：

> 预计费用请以阿里云百炼当前价格和控制台实际结算为准。

---

## 建议人工步骤（执行日）

1. 确认上述 11 项核对表全部勾选。
2. 本机 `.env.local`（不提交）临时设置：
   - 同一地域的 `DASHSCOPE_API_KEY` / `DASHSCOPE_WORKSPACE_ID` / `DASHSCOPE_REGION`
   - `VIDEO_PROVIDER=aliyun-wan27`
   - `ALLOW_PAID_GENERATION=true`
   - `WAN_RESULT_ALLOWED_HOSTS=` 先留空亦可（见下）
3. 重启唯一开发服务器，建议：`npm run dev:local-paid-test`（仅 `127.0.0.1`；禁止隧道 / 局域网共享）。
4. 打开本机测试卡片：完成当日价格确认、Token、Arm；确认 `readyForPaidSubmission` 在代码门闩下仍为 false。
   > 注意：3D-B6-B 仍强制 `readyForPaidSubmission=false`，真实提交路径未接线。需后续阶段接线并人工解除门闩后才可真实提交；**当前禁止执行付费**。
5. 使用 Dry Run / Simulation 做零费用演练（不得当作真实 Provider 成功）。
6. （后续阶段接线后）创建唯一一条 T2V 任务 → 等待 SUCCEEDED → 处理 allowlist → `retryTransfer`（不重新计费）。
7. 立刻恢复：
   ```env
   VIDEO_PROVIDER=mock
   ALLOW_PAID_GENERATION=false
   ```
8. 重启服务；确认默认 mock。

---

## 首次结果域名审批流程

官方不承诺固定结果 OSS 域名。

1. **不要**在代码里硬编码猜测域名。
2. `WAN_RESULT_ALLOWED_HOSTS` 默认保持为空。
3. allowlist 为空**不会**关闭 SSRF 防护；真实转存保持禁用。
4. 首次真实成功时可能出现：
   - Provider 任务已成功（可能已计费）
   - 本地真实转存被 allowlist 阻止（`RESULT_HOST_ALLOWLIST_NOT_CONFIGURED` / `RESULT_HOST_NOT_ALLOWED`）
5. API 仅返回脱敏 hostname（`remoteVideoSummary`），不返回签名 query / 完整签名 URL。
6. 管理员人工确认 hostname 后：
   - 在本机 `.env.local` 写入 **exact host**（禁止 `*`）
   - 重启服务
   - 调用 `POST /api/generations/[id]/transfer`（`retryTransfer`）
7. `retryTransfer` **不**创建新的 Provider 任务，**不会**产生新的生成费用。
8. 必须在远程 URL 约 24 小时有效期内完成。
9. 不允许临时关闭 SSRF 防护。
10. 不把首次遇到的域名硬编码进仓库默认值。

---

## 成功判定

- 本地生成 `generatedVideo` 资产并可播放
- GenerationRecord 状态 `completed`
- 参数对照三列可读
- 未调用第二次 Provider 创建
- 测试后环境已恢复 mock / 付费关闭

## 失败时

- 记录 `errorCode`（中文提示）与控制台 `request_id`（勿把密钥写入仓库）
- UNKNOWN / unknownOutcome：**不要**用同一幂等键重试
- 结果 URL 过期：无法 `retryTransfer`，只能新任务（`retryGeneration` 可能再次计费）
