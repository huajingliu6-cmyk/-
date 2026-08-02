# Go 远端迁移：AI API 配置续作交接（2026-08-01）

> 本报告供**新的 Agent**在同一 Dirty 工作区继续。它只覆盖最新的 AI 基础 API 配置域；旧的 `docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md` 中“workflow 尚未迁移”的描述已过时，不能作为当前事实。

## 仓库与红线

- 仓库：`C:\Users\江城的助手\Downloads\24\infinite-canvas`
- 分支 / 基线 HEAD：`feat/react-flow-migration` / `a8149a0a6e791d9fc2f2ac431a3773ace821870a`
- 工作区：大量 Dirty，含此前未提交成果；逐文件查看 diff，不能以 `git status` 推断改动归属。
- 严禁：`reset`、`clean`、`restore`、盲目 `git add`、删改既有 `data/`、自动 commit/push。
- 测试必须同时隔离 `APP_DATA_DIR` 和 `DATA_ROOT`；Smoke 使用非 `3000` 端口，不停止、不复用、不占用用户 `:3000`。
- 绝不改变：`VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`TEXT_LLM_PROVIDER=mock`。
- `WORKSPACE_CONFIRM_REQUIRES_APPROVAL` 的直接确认反绕过必须仍返回 `403`。
- 用户目标架构不变：Next.js 前端与 Go Web 后端分离；PostgreSQL 持久化；SSDB 缓存；业务数据走内网远端；生产和浏览器不保存本地业务数据；Go JSON 请求日志 + PostgreSQL 审计。
- 工具注意：`rg` 不可用，使用 PowerShell `Get-ChildItem | Select-String`；使用 `npx.cmd`，不要使用 `npx.ps1`。

## 必读顺序

1. `docs/AGENT_CONTINUE_HANDOFF.md`
2. `docs/H1_CLOSE_HANDOFF_PATCH.md`
3. `docs/CURRENT_PROJECT_MASTER_HANDOFF.md`
4. `docs/SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md`
5. `docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`
6. `docs/AI_TASK_RULES_ARCHITECTURE.md`
7. `docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md`
8. 本文件
9. `docs/GO_REMOTE_BACKEND.md`

涉及 Next.js API 或行为前，遵守根目录 `AGENTS.md`：先读 `node_modules/next/dist/docs/` 对应版本文档。

## 已完成迁移（不重复做）

- Go documents / blobs / PostgreSQL audit / SSDB cache，以及身份、成员、项目、故事、剧本、资产、审批、通知等核心域已远端化。
- 视频任务、视频幂等预留、生成视频 Blob、远端 Mock 无复制、视频远端出站脱敏 stdout 日志已完成。
- 工作流画布已完成远端存储：`workflow/{projectId}` + `workflow-index/all`，首次原子写、后续 CAS、过期副本冲突不自动覆盖；专项已通过 `32 tests`。
- 文本积分已完成远端存储：账户与预留文档采用两文档原子 CAS；专项已通过 `7 tests`。
- 已通过的其他近期专项：视频远端任务/幂等/Blob/Mock `12 tests`，视频 Blob/下载/播放 `77 tests`；Go `test ./...` 曾通过。

## 当前域：AI 基础 API 配置

### 已在工作区实现，尚未全部验证

- 文件：`src/auth/api-config.ts`。
- 远端模型：namespace `generation-api-configs`，key `global`。
- `REMOTE_DATA_ONLY` 下已使用远端读写、`revision` CAS、冲突后重读、按 `updatedAt` 合并配置槽与 capability binding。
- `mergeRemoteApiConfigFiles` 审计按 ID 去重并保留最近 200 条。
- 密钥继续使用 `sealApiKeyForStorage()` 的 AES-256-GCM 加密后再写远端。
- 新测试：`src/ai-config/__tests__/remote-api-config-store.test.ts`。
  - 密钥只以密文保存。
  - 不同 slot 的并发更新可合并。
  - binding 可保存，planned capability 仍禁止启用。
  - 隔离根目录零本地文件。

### 当前唯一已知失败：先处理

最近执行：

```powershell
npx.cmd vitest run `
  src/ai-config/__tests__/remote-api-config-store.test.ts `
  src/ai-config/__tests__/ai-config-store.test.ts `
  src/ai-config/__tests__/secret-crypto.test.ts
```

结果：

- `remote-api-config-store.test.ts`：`3/3` 通过。
- `secret-crypto.test.ts`：`9/9` 通过。
- `ai-config-store.test.ts`：`13` 个中 `1` 个失败：`defaults include story and outline text profiles`。
- 根因：`src/auth/api-config.ts` 中的 `maskApiKey()` 保留密钥前三字符。`sk-...` 会公开为 `sk-••••bebb`，触发公共配置不得匹配 `/sk-/` 的泄露检查。

修复原则：

1. 修改 `maskApiKey()`，不公开 `sk-` 或其他密钥前缀；可以只输出固定掩码与末尾少量字符。
2. 检查 `src/ai-config/model-connections.ts` 中独立同名掩码函数的输出策略；本步骤不迁移该域。
3. 不可放宽测试、清空默认环境密钥来掩盖问题，或改变 provider/付费默认/密钥加密/校验顺序/planned capability 保护。

### 完成标准

1. 上述三个 API 配置专项测试均通过。
2. 对改动跑 ESLint、隔离 TypeScript、`git diff --check`。
3. 更新 `docs/GO_REMOTE_BACKEND.md`，写明 `generation-api-configs/global`、CAS 合并、密钥密封和零本地落盘。
4. 远端路径不得生成本地 `generation-api-configs.json`。

## 后续顺序（一次只做一个域）

1. 完成本文件的 API 配置掩码修复和验证。
2. `src/ai-config/model-connections.ts`：仍读写 `ai-model-connections.json`，以后独立迁移成 `ai-model-connections/global`，保留密钥加密、slot binding、虚拟 legacy connection、testConnection 状态和 CAS。
3. `src/ai-config/task-rules-store.ts`：仍读写 `ai-task-rules.json`，以后独立迁移并补远端 CAS / 隔离测试。

## 不要顺手修

- `video-paid-gate-routes.test.ts` 的既有 `403` / `422` 验证顺序问题与本域无关。
- Storyboard typecheck 中 `resolveAssetImageStorageKey` 缺少 `id` 与本域无关。
- `docs/GO_REMOTE_BACKEND.md`、`docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md` 当前均为 untracked，含已有迁移成果，不能丢弃。
- 普通图片/音频的远端 Blob GET 仍需单独核验，不能无上下文凭 asset ID 猜 Blob。

## 给新 Agent 的首条指令

```text
先读 docs/AGENT_CONTINUE_HANDOFF.md 并按其阅读顺序读基线，再读 docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md 和 docs/GO_REMOTE_API_CONFIG_CONTINUE_HANDOFF.md。仓库 C:\Users\江城的助手\Downloads\24\infinite-canvas，分支 feat/react-flow-migration，HEAD a8149a0a6e791d9fc2f2ac431a3773ace821870a，工作区大量 Dirty。禁止 reset/clean/restore/盲目 add/删改既有 data/自动 commit/push；测试隔离 APP_DATA_DIR 与 DATA_ROOT；不使用用户 :3000；不改 VIDEO_PROVIDER=mock、ALLOW_PAID_GENERATION=false、TEXT_LLM_PROVIDER=mock。只处理当前 AI 基础 API 配置域：先修 src/auth/api-config.ts 中 maskApiKey 公开 sk- 前缀、导致 ai-config-store 测试失败的问题；不放宽测试、不改付费默认、不顺带迁移 model-connections。完成后跑 API 配置专项、ESLint、隔离 TypeScript、git diff --check，并更新 docs/GO_REMOTE_BACKEND.md。
```
