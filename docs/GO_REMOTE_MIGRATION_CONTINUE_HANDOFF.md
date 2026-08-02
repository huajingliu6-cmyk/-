# Go / PostgreSQL / SSDB 远程迁移续作交接（2026-08-01）

> 本文件是新 Agent 的最新续作入口。旧交接中的“API 配置未收口”“模型连接未迁移”“任务规则尚未实现”“普通工作流图片/音频不能远端读取”等描述已经过期。以当前工作区、本文和当次验证结果为准。

## 1. 仓库与强制约束

- 仓库：`C:\Users\江城的助手\Downloads\24\infinite-canvas`
- 分支：`feat/react-flow-migration`
- HEAD：`a8149a0a6e791d9fc2f2ac431a3773ace821870a`
- 工作区：大量 Dirty；本次核对时 `git status --short` 为 201 项，包含多个阶段的未提交成果。
- 禁止：`git reset`、`git clean`、`git restore`、盲目 `git add`、删改现有 `data/`、自动 commit、自动 push。
- 不得根据 Dirty 列表推断文件归属；修改前逐文件查看当前代码和 diff。
- 测试必须同时隔离 `APP_DATA_DIR` 与 `DATA_ROOT`，不得读写仓库现有 `data/`。
- Smoke 只能使用非 `3000` 端口；不得停止、复用或探测性占用用户 `:3000`。
- 付费默认必须保持：
  - `VIDEO_PROVIDER=mock`
  - `ALLOW_PAID_GENERATION=false`
  - `TEXT_LLM_PROVIDER=mock`
- `WORKSPACE_CONFIRM_REQUIRES_APPROVAL` 的直接确认反绕过必须继续返回 `403`。
- 不执行历史数据导入；禁止 `npm run db:legacy:import --apply`。
- 日志不得记录 API Key、Token、密码、Cookie、请求正文或用户内容。
- 涉及 Next.js Route Handler 或框架行为前，先阅读当前安装版本 `node_modules/next/dist/docs/` 对应文档。
- 本机 `rg` 不可用时使用 PowerShell `Get-ChildItem | Select-String`；使用 `npx.cmd`，不要用 `npx.ps1`。

目标架构保持不变：Next.js 前端与 Go Web 后端分离；PostgreSQL 为持久化事实源；SSDB 只作可失效缓存；生产业务数据全部走内网服务；Next.js 生产进程和浏览器不保存本地业务数据；Go 输出 JSON 请求日志，审计事件写 PostgreSQL。

## 2. 阅读顺序

1. `docs/AGENT_CONTINUE_HANDOFF.md`
2. `docs/H1_CLOSE_HANDOFF_PATCH.md`
3. `docs/CURRENT_PROJECT_MASTER_HANDOFF.md`
4. `docs/SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md`
5. `docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`
6. `docs/AI_TASK_RULES_ARCHITECTURE.md`
7. `docs/GO_REMOTE_BACKEND.md`
8. 本文件 `docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md`

冲突优先级：当前用户指令与红线 > `AGENTS.md` > 新专项交接 > 旧总交接。当前代码和当次测试是最终事实来源。

## 3. 已确认完成的远端基础设施与业务域

除非专项回归暴露问题，不要重复设计或重做：

- Go documents / blobs / auth logs / PostgreSQL audit。
- PostgreSQL document revision CAS、SSDB 文档缓存失效、多文档原子事务。
- Blob put/get/delete、copy、existence check。
- 用户、身份、项目成员、项目目录、故事、剧本、资产与设计、审批、通知等核心域。
- 管理端到工作区同步；审批 submit/approve/reject 原子链路。
- 文本生成任务历史、设计提示词/图片生成、人物图片预检、分镜生产工作区。
- 视频工作流文档与索引；首次保存原子写索引，后续整文档 CAS。
- 视频任务记录、全局索引和视频幂等预留。
- 生成视频 Blob、安全内存下载、完整与单 Range 播放。
- 远端 Mock 不复制 `generated-videos` 中间文件，只读取验证后的只读 Mock 源。
- 视频出站日志：远端模式只输出脱敏单行 JSON stdout，不写本地 TXT。
- 文本积分账户与 generation reservation：多文档原子 CAS、并发不超扣、幂等 reserve/settle/release。
- 生成 API 配置：`generation-api-configs/global`。
- 模型连接目录：`ai-model-connections/global`。
- AI 任务规则：`ai-task-rules/{capabilityId}`。
- 本机一次性付费测试 guard：`local-paid-test-guard/{live|simulation}`。
- 工作流普通图片、音频与生成视频均可从 Go Blob 读取。
- HTTP Provider 的同步、Ark、OpenAI 与 SD2 完成结果在远端模式先写受限临时 Blob，再转存正式工作流 Blob，不创建 `generated-videos`。

详细模型和接口见 `docs/GO_REMOTE_BACKEND.md`。

## 4. 本轮已完成并验证

### 4.1 API Key 公共掩码

文件：

- `src/auth/api-config.ts`
- `src/ai-config/model-connections.ts`

两处公共掩码均已改为固定掩码加末尾 4 位：

```ts
return `********${key.slice(-4)}`;
```

公共响应不再暴露 `sk-` 或其他 Key 前缀；密钥验证、AES-256-GCM 存储、运行时解析、Provider 默认和 UI 行为未改变。

最近隔离回归：5 files / 34 tests passed：

- `remote-api-config-store.test.ts`
- `ai-config-store.test.ts`
- `secret-crypto.test.ts`
- `remote-model-connections.test.ts`
- `model-connections.test.ts`

相关 ESLint、隔离 TypeScript 和 `git diff --check` 通过。全量 TypeScript 仍被既有跨域错误阻断，不要顺手修无关域。

### 4.2 AI 任务规则远端实现

文件：

- `src/ai-config/task-rules-store.ts`
- `src/ai-config/remote-task-rules-store.ts`
- `src/ai-config/__tests__/remote-task-rules-store.test.ts`

当前代码已经实现：

- 命名空间：`ai-task-rules`
- 每个 capability 一份文档：`ai-task-rules/{capabilityId}`
- 缺失文档只返回内存 builtin/空记录，不产生读时写入。
- 读取时保存 capability 级远端 revision 和基线记录，并校验版本号与 content hash。
- 写入只提交发生变化的 capability。
- 同 capability 过期写入映射为 `AI_TASK_RULE_REVISION_CONFLICT`；发布、回滚和 use-builtin 不自动重放，不做静默覆盖。
- 不同 capability 可独立并发写入。
- 草稿 revision、发布/回滚幂等键、历史版本、rollback 新建版本、revert builtin 和 planned capability 保护保持不变。
- 远端模式不创建 `ai-task-rules.json` 或 `.tmp` 文件。

当前可重复专项验证通过：

- `remote-task-rules-store.test.ts`：6/6
- `task-rules-store.test.ts`：7/7
- `admin-task-rules-route.test.ts`：2/2
- `execution-plan.test.ts`：4/4
- 合计：4 files / 19 tests passed
- ESLint、隔离 TypeScript、`git diff --check` 通过。

完整测试应覆盖：

1. 缺失 capability 只使用 builtin，不写远端或本地。
2. 草稿只写对应 `ai-task-rules/{capabilityId}`。
3. publish / rollback / revert / idempotency 语义。
4. 不同 capability 并发更新均保留。
5. 同 capability stale write 映射 `AI_TASK_RULE_REVISION_CONFLICT`。
6. planned capability 不能通过规则激活或发布非法指令。
7. `APP_DATA_DIR` 和 `DATA_ROOT` 隔离目录零文件。

### 4.3 工作流普通图片/音频远端读取

文件：

- `src/app/api/assets/[assetId]/route.ts`
- `src/workflow/lib/asset-storage.ts`
- `src/workflow/__tests__/remote-asset-read-route.test.ts`

当前实现要求普通图片/音频 GET 显式提供 `projectId`，读取前校验工作流 `AssetRecord` 的 project、assetId、资产类型和 MIME，再读取 `workflow-assets/{assetId}`。非法 ID、缺失记录、缺失 Blob、类型不匹配和 Blob MIME 不匹配均拒绝；`generatedVideo` 仍走原有 generation/project 安全分支。

主会话复验：2 files / 6 tests passed，包括既有远端生成视频 Blob 回归；ESLint 通过；隔离目录零文件。

### 4.4 legacy generated-videos 路由远程封锁

文件：

- `src/app/api/generated-videos/[fileName]/route.ts`
- `src/video-generation/__tests__/generated-videos-route.test.ts`

当前实现：`REMOTE_DATA_ONLY=true` 或生产模式下，在解析路径或读取文件前直接返回 `404`，不允许通过 legacy 路由读取本地 `generated-videos`。本地隔离开发模式继续兼容原行为。

最近验证：

- `generated-videos-route.test.ts`
- `remote-mock-provider-no-copy.test.ts`
- `remote-generated-video-blob.test.ts`
- 3 files / 4 tests passed
- ESLint、隔离 TypeScript、`git diff --check` 通过。

### 4.5 Go 后端

从 `backend/` 运行：

```powershell
C:\Temp\go1.24.12-portable\go\bin\go.exe test ./...
```

当前通过。仓库根目录不是 Go module，不能从根目录运行该命令。

### 4.6 Provider 项目图片与绑定音色远端解析

文件：

- `src/video-generation/asset-resolver.ts`
- `src/video-generation/__tests__/remote-project-draft-image-resolve.test.ts`
- `src/video-generation/__tests__/remote-project-voice-resolve.test.ts`

真实 Provider 使用项目草稿图片时，远端模式现在通过 `getRemoteAssetImage(projectId, storageKey)` 读取 Go Blob；项目绑定音色先从远端项目资产草稿确认 `projectId + assetId` 音频元数据，再通过 `getRemoteAssetAudio(projectId, voiceAssetId)` 读取 Go Blob。两条链路均不再在 `REMOTE_DATA_ONLY` / production 下读取 Next.js 本地磁盘。

保持的安全语义：

- 图片继续执行 10MB 上限、内容嗅探与 JPEG/PNG/WebP 白名单。
- 音频继续执行 50MB 上限；`audio/x-wav` 规范化为 `audio/wav`，只接受现有 MPEG/WAV/OGG MIME；Blob MIME 必须与项目音频元数据规范化后完全一致。
- 元数据缺失、元数据属于其他项目或 MIME 不一致时，在读取 Blob 或生成 Provider media 前拒绝。
- 缺失 Blob、非法 MIME 或超限均显式失败，不回退本地磁盘。
- Mock Provider 仍使用项目音频流式路由；本地开发模式仍保留文件读取兼容。
- 测试同时隔离 `APP_DATA_DIR` 与 `DATA_ROOT`，远端用例确认零本地文件。

最近验证：

- 项目音色 data URL、Provider `referenceVoiceUrl`、元数据/Blob 校验及项目隔离：6 tests passed。
- reference-media selection 与本地/远端项目图片兼容回归：3 files / 28 tests passed。
- 合计：4 files / 34 tests passed；隔离目录零文件。
- 相关 ESLint、隔离 TypeScript、`git diff --check` 通过。

### 4.7 一次性付费测试 guard 与 HTTP Provider 临时结果

文件：

- `src/video-generation/local-paid-test/guard-store.ts`
- `src/video-generation/__tests__/remote-local-paid-test-guard.test.ts`
- `src/video-generation/provider/http-video-provider.ts`
- `src/video-generation/remote-provider-result.ts`
- `src/video-generation/transfer-video.ts`
- `src/video-generation/__tests__/remote-http-legacy-result.test.ts`

远端或 production 模式下，一次性付费测试 guard 不再在构造时解析本地目录，也不写 guard JSON。它以 `local-paid-test-guard/{live|simulation}` 单文档 revision CAS 保存安全状态；记录只含状态、generation/task ID、请求指纹和 nonce 哈希。原始 nonce、Token、Key、提示词和 URL 均不保存。旧 revision 的并发写入安全拒绝，不能覆盖已经提交中的状态。

此变更没有启用任何付费能力：`VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`、`TEXT_LLM_PROVIDER=mock` 保持不变，现有 local paid gate 回归仍通过。

HTTP Provider 的 legacy-sync、Ark、OpenAI 与 SD2 完成结果在远端模式不再物化 `generated-videos` 或 `.tmp`。下载缓冲先存入不可猜测的 `video-provider-results/{resultId}` Go Blob，generation 仅保存受限 `remote-blob:` 引用；转存器复用既有 remoteProviderBlob 契约，校验大小、MIME、HTML/JSON 伪响应、MP4 ftyp 和占位哈希，保存最终 `workflow-assets/{assetId}` 后清理临时 Blob。

最近专项通过：

- API 配置、模型连接、任务规则、远端付费 guard、HTTP 临时结果和生成视频 Blob：6 files / 16 tests passed。
- HTTP Provider、SD2、远端生成视频 Blob 与 secure transfer：4 files / 63 tests passed。
- local paid gate + 远端 guard：2 files / 15 tests passed。
- `backend/` 下 Go test ./... 通过。
- 本批 ESLint 和 git diff --check 通过。

### 4.8 G1-R 隔离浏览器 Smoke

`2026-08-01` 已完成 G1-R 浏览器 Smoke：使用 `scripts/smoke-batch-g1-seed.ts` 和 `scripts/smoke-batch-g1-browser.ts`，在独立临时源码副本运行 Next.js `3044`，没有复用、停止或读取用户 `:3000` 服务。种子和服务均使用 OS 临时目录的同一隔离 `APP_DATA_DIR` / `DATA_ROOT`，并保持 mock / false / mock 默认。

报告显示 `passed: true`，通过步骤：mock extraction 配置、extract、edit-save、confirm、stale、empty、cancel、非法 JSON 恢复；报告中 `touchedPort3000: false`。临时源码副本在 Smoke 后已删除，仅保留隔离报告目录供需要时查看。

### 4.9 当前收口验证与生产本地路径审计

本轮最终复验结果：

- `backend/` 下 `go test ./...` 全部通过。
- 核心远端专项集合：22 test files / 78 tests passed。
- HTTP Provider、SD2、远端生成视频 Blob 与 secure transfer：4 files / 59 tests passed。
- 本地专用入口专项：4 files / 14 tests passed。
- 所有 Node 测试同时隔离 `APP_DATA_DIR` 与 `DATA_ROOT`；本轮没有运行新的 Smoke，没有触碰用户 `:3000`。

生产本地路径审计已收口的事实：

- `project-storage.ts` 的业务调用统一经过 `project-access.ts`，远端模式优先，不要看到路径 helper 就重复迁移。
- `create-idempotency.ts` 只服务 legacy file 分支；远端项目目录自身以原子写承载创建幂等。
- `asset-audio-storage.ts` 的本地 helper 只在 PUT/DELETE 远端分支返回后可达；Provider 绑定音色已有远端读取分流。
- `approvals/promote.ts` 的本地 `fs.access` 仅用于 legacy 审批路径；远端审批使用 `remote-approve.ts`。
- `FileGenerationIdempotencyStore` 仅在非远端模式注册；远端使用 `RemoteGenerationIdempotencyStore`。
- Mock 视频源是只读开发夹具；远端模式不复制、不写业务文件。
- 浏览器代码未发现通过 `localStorage`、`sessionStorage` 或 IndexedDB 保存业务数据。
- 旧 `FileStorageService` / `getFileStorageProvider()` 没有生产业务调用，仅为遗留基础设施。

## 5. 新 Agent 的第一步

代码迁移和当前可离线验证已基本收口。下一步不是继续批量替换文件存储，而是先确认是否具备受控内网测试环境；只有依赖就绪后才执行真实集成：

```text
1. 要求用户或运维提供批准的 SSDB 镜像、独立测试 PostgreSQL URL、内部 Token，或授予启动 Docker 的权限。
2. 依赖就绪后启动独立 PostgreSQL、SSDB 与 Go API，禁止连接真实生产库或把服务暴露到公网。
3. 使用非 3000 端口执行远端集成测试和 G1-R 浏览器 Smoke，同时隔离 APP_DATA_DIR 与 DATA_ROOT。
4. 仅当运营提供真实 SD2 URL 和 Key 时做 SD2 真机联调；不得编造或猜测凭据。
```

当前环境没有 PostgreSQL、SSDB 或真实 SD2 凭据时，不要假装完成这些联调。离线代码审计与隔离专项已经基本收口，不要为了制造进度重复已完成迁移。

本次核对时：`TEST_DATABASE_URL`、`DATABASE_URL`、`SSDB_ADDRESS`、`SSDB_IMAGE`、`INTERNAL_API_TOKEN`、`GO_BACKEND_INTERNAL_URL`、`SD2_PLATFORM_API_URL` 和 `SD2_PLATFORM_API_KEY` 均未设置；Windows 服务 `com.docker.service` 状态为 `Stopped`，`docker info` 无法连接 `docker_engine` daemon。当前权限此前也无法启动该服务。`deploy/compose.remote.yml` 还要求运维批准并提供 `SSDB_IMAGE`。因此真实 Go/PostgreSQL/SSDB 集成和 SD2 真机联调必须等待用户或运维提供受控内网环境，不能由 Agent 编造配置或凭据。

## 7. 后续审计方向

HTTP Provider 文件链路和生产本地路径审计均已完成。以下条目已经确认，不应再作为待迁移事项：

- `src/projects/create-idempotency.ts`：已确认 `REMOTE_DATA_ONLY` 路由使用远端项目目录自身 idempotency，文件模块只服务 legacy `PERSISTENCE_DRIVER=file`；不要重复迁移。
- `src/projects/project-storage.ts`：业务调用由 `project-access.ts` 统一远端优先；其余多数为 legacy file 路径和路径辅助函数。
- `src/video-generation/local-paid-test/guard-store.ts`：远端 guard 已完成；不得因此改变付费默认。
- `src/video-generation/outbound-log/video-outbound-txt-log.ts`：远端分支只输出脱敏 JSON stdout，不写 TXT。
- `src/app/api/local-voices/*` 与本地声音库：远端模式返回空列表，不枚举或读取服务器目录。

目标是生产 `REMOTE_DATA_ONLY` 零本地业务读写，不是删除全部本地开发兼容代码。

## 8. 已知无关问题

全量 `npx.cmd tsc --noEmit` 当前仍被多个既有跨域错误阻断，包括但不限于：

- Storyboard asset helper 缺少 `id`。
- 若干 storyboard nullable/type mismatch。
- 旧 smoke fixture 缺少 `voiceBound`。
- 多个视频测试 fixture 使用旧枚举值。
- 远端 transaction 测试的 mock tuple 类型问题。

不要在单一迁移小步中顺手修这些无关错误。使用仓库内临时 `tsconfig` 只覆盖当前文件，验证后删除临时配置。

`video-paid-gate-routes.test.ts` 仍有既有 `403` / `422` 校验顺序问题；不要为远端迁移改变验证顺序。

## 9. 隔离验证模板

```powershell
$tmp = Join-Path $env:TEMP ("ic-remote-test-" + [guid]::NewGuid().ToString("N"))
$env:APP_DATA_DIR = Join-Path $tmp "app-data"
$env:DATA_ROOT = Join-Path $tmp "data-root"
```

每个测试命令使用独立 `$tmp`。测试结束后只删除该次明确创建并核验过的临时目录，不得触碰仓库 `data/`。

推荐门禁顺序：

```powershell
npx.cmd vitest run <本小步测试>
npx.cmd eslint <本小步文件>
npx.cmd tsc --noEmit -p <临时隔离 tsconfig>
git diff --check -- <本小步文件与文档>
```

若涉及 Go：

```powershell
Set-Location backend
C:\Temp\go1.24.12-portable\go\bin\go.exe test ./...
```

本次交接更新未运行 Smoke，未触碰用户 `:3000`，未 commit，未 push。

## 10. 可直接复制给新 Agent 的开场

```text
先读 docs/AGENT_CONTINUE_HANDOFF.md，再按其中阅读顺序读基线，然后读 docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md。仓库 C:\Users\江城的助手\Downloads\24\infinite-canvas，分支 feat/react-flow-migration，HEAD a8149a0a6e791d9fc2f2ac431a3773ace821870a，工作区 201 项 Dirty。禁止 reset/clean/restore/盲目 add/删改 data/自动 commit/push；不改付费默认；测试同时隔离 APP_DATA_DIR 与 DATA_ROOT；Smoke 用非 3000 端口，不停止或复用用户 :3000；日志不得记录秘密或用户内容。

从新交接第 5 节开始。代码迁移和离线验证已基本收口，不要重复 API Key 掩码、任务规则、项目图片/音色、HTTP staging、本地专用入口或生产本地路径审计。当前真实阻塞是 Docker daemon 停止，TEST_DATABASE_URL、DATABASE_URL、SSDB_ADDRESS、SSDB_IMAGE、INTERNAL_API_TOKEN 等均未配置。先请求用户或运维提供批准的 SSDB 镜像、独立测试数据库 URL、内部 Token 或启动 Docker 的权限；依赖就绪后再用非 3000 端口和隔离 APP_DATA_DIR/DATA_ROOT 执行真实 PostgreSQL + SSDB + Go 集成与 G1-R Smoke。不得伪造结果、猜测凭据、连接生产库或暴露公网。
```
> SUPERSEDED FOR BLOB STORAGE STATUS: read docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md first. Provider file auditing and independent blobstore code integration are complete; real controlled-environment integration remains.
