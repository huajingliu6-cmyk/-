# AI 任务规则与执行计划架构（H2-AI-CONTROL）

> 写入时间：2026-07-29 Asia/Shanghai  
> 代码路径：`src/ai-config/*`、`src/auth/ai-admin/*`、`src/text-generation/run-generation.ts`  
> 关联文档：`CURRENT_PROJECT_MASTER_HANDOFF.md` 第 11 章 · `AI_BUTTON_API_CONFIG_AUDIT.md`

---

## 1. 设计目标

H2 将 AI 控制面拆为两层独立配置：

| 层 | 回答的问题 | 存储 |
|----|-----------|------|
| **modelConnection** | 用什么模型、如何连 Provider | `ai-model-connections.json` |
| **taskRule** | 该 capability 的任务指令是什么 | `ai-task-rules.json` |

运行时通过 `resolveAiExecutionPlan` 合并平台固定策略、已发布规则、输出契约与不可信用户数据，**单次**调用 Provider，并在 generation job 中写入可追溯元数据。

---

## 2. 四层 Prompt 组装

文本生成（`run-generation.ts`）在 capability 可解析时采用四层结构：

```
┌─────────────────────────────────────┐
│ 1. PLATFORM_SYSTEM_POLICY           │  ← 平台固定；管理员不可覆盖
│    buildPlatformSystemPolicy()      │
├─────────────────────────────────────┤
│ 2. ADMIN_PUBLISHED_TASK_RULE        │  ← builtin 或 custom 已发布规则
│    getEffectivePublishedRule()      │
├─────────────────────────────────────┤
│ 3. IMMUTABLE_OUTPUT_CONTRACT        │  ← 按 capability 固定；冲突以契约为准
│    buildImmutableOutputContract()   │
├─────────────────────────────────────┤
│ 4. UNTRUSTED_PROJECT_DATA (user)    │  ← 项目 brief / 剧本正文等
│    assembleUntrustedUserData()      │
└─────────────────────────────────────┘
```

实现：

| 函数 | 文件 | 作用 |
|------|------|------|
| `assembleTextSystemPrompt` | `prompt-assembly.ts` | 合并层 1–3 为 system prompt |
| `assembleUntrustedUserData` | `prompt-assembly.ts` | 层 4：`<DATA label="…">` 包裹，声明不可覆盖系统规则 |
| `buildPlatformSystemPolicy` | `system-policy.ts` | 硬规则：不泄露密钥、不绕过付费/schema、**不请求二次确认** |
| `buildImmutableOutputContract` | `output-contracts.ts` | 如 `script.split` 仅输出块边界 JSON，不得改写正文 |

**单次调用原则：** 系统策略明确禁止「request confirmation or a second-pass approval」；Provider 只被调用一次（`runtime-single-call.test.ts` 验证 mock 调用计数为 1）。

---

## 3. modelConnection vs profileSlot

| 概念 | 说明 |
|------|------|
| **profileSlot** | Capability 注册表中的固定槽位 ID（如 `script-split-text`、`story-text`）；每个 active capability 通过 binding 指向一个 slot |
| **modelConnection** | 管理员创建的可复用接入记录：`id`、`displayName`、`modality`、`providerMode`（mock/http/aliyun-wan27）、`baseUrl`、`modelId`、加密 `apiKey` 等 |
| **slotBindings** | `ai-model-connections.json` 内 `slotBindings[profileSlot] = modelConnectionId \| null` |
| **解析链** | `getCapabilityBinding(capabilityId)` → `profileSlotId` → `resolveConnectionForSlot(profileSlot)` → `ModelConnection` |

**与 legacy profile 的关系：** `generation-api-configs.json`（按 profileSlot 存的旧配置）仍可读；未绑定 modelConnection 时可合成 virtual legacy connection。新配置应优先走 modelConnection + slotBindings。

**UI：** `ApiManagePanel` → Tab `ai-config-tab-models`（CRUD + test）· Tab `ai-config-tab-rules`（每 capability 卡片内选 modelConnection）。

---

## 4. 任务规则生命周期

存储：`ai-task-rules.json`（`schemaVersion: 1`），按 `capabilityId` 索引。

| 阶段 | API | 说明 |
|------|-----|------|
| **builtin** | （默认） | 无 published 版本时使用 `builtin-task-rules.ts` 内置文案 |
| **draft** | `PUT .../draft` | 编辑或 Markdown 导入后的草稿；含 `revision` |
| **check** | `POST .../check` | 静态校验：空内容、控制字符、禁止 API Key 片段、禁止「改为 active」等 |
| **publish** | `POST .../publish` | 递增 `publishedVersion`，追加 `versions[]`，记录 `contentHash` |
| **rollback** | `POST .../rollback` | 回退到指定历史版本 |
| **use-builtin** | `POST .../use-builtin` | 清除 custom 发布，恢复 builtin |
| **import-markdown** | `POST .../import-markdown` | 上传 `.md` 写入 draft（最大 256 KiB） |
| **test-run** | `POST .../test-run` | 管理员试跑 `resolveAiExecutionPlan`（不扣用户积分） |
| **versions** | `GET .../versions` | 版本历史列表 |

**有效规则解析：** `getEffectivePublishedRule(capabilityId)` → `{ source: "builtin"|"custom", version, content, contentHash }`。

---

## 5. resolveAiExecutionPlan

入口：`src/ai-config/execution-plan.ts`

```
resolveAiExecutionPlan({ capabilityId, projectId, userId, dynamicInput, targetChars })
  → 校验 capability.status === "active"（planned 抛 AI_CAPABILITY_PLANNED）
  → 校验 binding.enabled + profileSlotId
  → resolveConnectionForSlot → modelConnection（enabled + secret 齐全）
  → getEffectivePublishedRule → taskRule
  → assembleTextSystemPrompt(systemPolicy + taskRule + outputContract)
  → 返回 AiExecutionPlan
```

`run-generation.ts` 在 `outputKindToCapabilityId` 命中时调用；成功则：

- `systemPrompt` = plan.systemPrompt  
- `userPrompt` = `assembleUntrustedUserData("project_brief", brief)`  
- 写入 job 元数据（见 §7）

解析失败时回退 legacy prompt 组装（向后兼容）。

---

## 6. 存储文件

| 文件 | 路径 | 内容 |
|------|------|------|
| `ai-model-connections.json` | `APP_DATA_DIR/` | `connections[]` + `slotBindings` |
| `ai-task-rules.json` | `APP_DATA_DIR/` | 每 capability 的 `draft`、`publishedVersion`、`versions[]` |
| `generation-api-configs.json` | `APP_DATA_DIR/` | legacy profile 配置（v2，加密 apiKey） |

测试与 Smoke **必须**隔离 `APP_DATA_DIR`；不得污染真实 `data/`。真实 `data/` 是在用业务库；产品操作导致的哈希变化属正常，不以全目录哈希钉死作为 H2/后续批次 COMPLETE 条件（详见 `H1_CLOSE_HANDOFF_PATCH.md`）。

---

## 7. Secret 加密

与 H1 一致：AES-256-GCM envelope `enc:v1:` + Base64 JSON；主密钥 `AI_CONFIG_ENCRYPTION_KEY`（server-only）。

- `modelConnection.apiKey` 落盘加密；内存解密后供 HTTP Provider 使用  
- GET Admin API 仅返回 `apiKeyConfigured` + `apiKeyMasked`  
- 缺失主密钥：不可保存新 Key；已加密 secret 不可解密 → `AI_MODEL_SECRET_MISSING`

---

## 8. 生成元数据字段

文本生成 job（`TextGenerationJob`，`projects/{projectId}/text-generations/*.json`）在 H2 运行时可选写入：

| 字段 | 类型 | 说明 |
|------|------|------|
| `capabilityId` | string | 如 `script.split.generate` |
| `taskRuleSource` | `"builtin"` \| `"custom"` | 规则来源 |
| `taskRuleVersion` | number \| null | 已发布版本号；builtin 为 null |
| `taskRuleHash` | string | 规则内容 SHA-256 |
| `modelConnectionId` | string \| null | 实际 modelConnection.id |
| `systemPolicyVersion` | string | 当前为 `"1"` |
| `outputContractVersion` | string | 输出契约版本 |
| `inputFingerprint` | string | dynamicInput + projectId 指纹 |

H2 浏览器 Smoke（`:3043`）对 `script.split.generate` 跑通后校验上述字段存在且 Provider 仅调用一次。

---

## 9. planned 不可被配置激活

以下 capability **仍为 planned**，不受任务规则或 modelConnection 影响：

| capabilityId | 服务端行为 |
|--------------|-----------|
| `script.episodes.generate` | `resolveAiExecutionPlan` → `AI_CAPABILITY_PLANNED` |
| `script.continue.generate` | 同上 |

任务规则 `checkRule` 拒绝含「planned.*active」「改为 active」等指令。Registry `status` 是唯一真相来源；Admin UI 不对 planned capability 提供 publish 路径。

---

## 10. Admin API 索引

| Method | Path |
|--------|------|
| GET/POST | `/api/admin/model-connections` |
| GET/PATCH/DELETE | `/api/admin/model-connections/[connectionId]` |
| POST | `/api/admin/model-connections/[connectionId]/test` |
| GET/PUT | `/api/admin/ai-model-bindings` |
| GET | `/api/admin/ai-task-rules` |
| GET | `/api/admin/ai-task-rules/[capabilityId]` |
| PUT | `/api/admin/ai-task-rules/[capabilityId]/draft` |
| POST | `/api/admin/ai-task-rules/[capabilityId]/check` |
| POST | `/api/admin/ai-task-rules/[capabilityId]/publish` |
| POST | `/api/admin/ai-task-rules/[capabilityId]/rollback` |
| POST | `/api/admin/ai-task-rules/[capabilityId]/use-builtin` |
| POST | `/api/admin/ai-task-rules/[capabilityId]/import-markdown` |
| POST | `/api/admin/ai-task-rules/[capabilityId]/test-run` |
| GET | `/api/admin/ai-task-rules/[capabilityId]/versions` |

权限：**SYSTEM_ADMIN** only（`requireSystemAdmin`）。

---

## 11. 测试与 Smoke

| 项 | 结果 |
|----|------|
| 单元/路由 | `execution-plan.test.ts`、`task-rules-store.test.ts`、`model-connections.test.ts`、`admin-task-rules-route.test.ts`、`runtime-single-call.test.ts` 等 |
| Vitest 全量 | **100** files / **755** passed |
| 浏览器 Smoke | `scripts/smoke-batch-h2-browser.ts` · :**3043** · 隔离 `APP_DATA_DIR` · **29/29** · 报告 `C:\Temp\h2-browser-report.json` · **未**污染真实 `data/` |
| H2 批次状态 | 功能验收 **COMPLETE** + 批次总状态 **COMPLETE**（不以 data 哈希 PARTIAL） |
| data/ 历史快照（仅追溯） | **844** / `5d645e996eb87a7f1ea36de6d10d9f8a4bd411ca61d1991fa2d84458afe6ffb9` |
| data/ VERIFY 观测 | **847** / `2b51d4336777093f8d16a81803ec66f77db0860382b533413eeceb8fbc3722c9`（**非**永久固定/干净基线） |
| 真实 data/ 中的 H2 配置文件 | **目前不存在** `ai-model-connections.json` / `ai-task-rules.json`（仅隔离 Smoke/测试环境会创建） |
| GET / 读取落盘 | **否**（缺文件用内存默认；仅 POST/PUT 保存/发布/回滚等写盘） |

---

## 12. 关键源码索引

| 模块 | 路径 |
|------|------|
| 执行计划 | `src/ai-config/execution-plan.ts` |
| Prompt 组装 | `src/ai-config/prompt-assembly.ts` |
| 系统策略 | `src/ai-config/system-policy.ts` |
| 输出契约 | `src/ai-config/output-contracts.ts` |
| 内置规则 | `src/ai-config/builtin-task-rules.ts` |
| 规则存储 | `src/ai-config/task-rules-store.ts` |
| 模型接入 | `src/ai-config/model-connections.ts` |
| 文本运行时 | `src/text-generation/run-generation.ts` |
| Admin UI | `src/auth/ApiManagePanel.tsx`、`src/auth/ai-admin/*` |
| Admin Routes | `src/app/api/admin/model-connections/*`、`ai-model-bindings/*`、`ai-task-rules/*` |
