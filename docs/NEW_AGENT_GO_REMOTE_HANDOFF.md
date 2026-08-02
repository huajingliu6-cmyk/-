# 新 Agent 续作交接：Go / PostgreSQL / SSDB 远端化

> 日期：2026-08-01  
> 仓库：`C:\Users\江城的助手\Downloads\24\infinite-canvas`  
> 分支：`feat/react-flow-migration`  
> HEAD：`a8149a0a6e791d9fc2f2ac431a3773ace821870a`

## 1. 阅读顺序

1. `docs/AGENT_CONTINUE_HANDOFF.md`
2. `docs/H1_CLOSE_HANDOFF_PATCH.md`
3. `docs/CURRENT_PROJECT_MASTER_HANDOFF.md`
4. `docs/SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md`
5. `docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`
6. `docs/AI_TASK_RULES_ARCHITECTURE.md`
7. `docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md`
8. `docs/GO_REMOTE_BACKEND.md`
9. 本文件

## 2. 新会话开场

```text
先按 docs/NEW_AGENT_GO_REMOTE_HANDOFF.md 第 1 节读完基线，再继续任务。

仓库 C:\Users\江城的助手\Downloads\24\infinite-canvas，分支 feat/react-flow-migration，HEAD a8149a0a6e791d9fc2f2ac431a3773ace821870a。工作区严重 Dirty，交接时 git status --short 为 201 项，以新会话只读实测为准。禁止 reset/clean/restore、盲目 add、删改 data/、自动 commit/push；不要覆盖其他未提交成果。

目标：Next.js 前端与 Go Web 后端分离；PostgreSQL 为持久化唯一事实源；SSDB 只作可丢弃缓存；生产 Web/浏览器零本地业务持久化，所有数据走内网服务；Go 输出脱敏 JSON 请求日志，重要变更写 PostgreSQL 审计。业务流程保持现状。

不改付费默认 VIDEO_PROVIDER=mock、ALLOW_PAID_GENERATION=false、TEXT_LLM_PROVIDER=mock。测试同时隔离 APP_DATA_DIR 与 DATA_ROOT。Smoke 只用非 3000 端口，不停止、不复用用户 :3000。保持 WORKSPACE_CONFIRM_REQUIRES_APPROVAL 直接确认返回 403。禁止 npm run db:legacy:import --apply。

不要重复已完成的远端存储、CAS、Blob、任务规则、项目音色、HTTP Provider 暂存链。第一步只复核受控 PostgreSQL、SSDB、Go 服务是否可用；若仍不可用，如实记录外部依赖阻塞，再继续生产可达本地读写审计。不要擅自启动 Docker Desktop或拉取未批准 SSDB 镜像。
```

## 3. 红线与架构

- 禁止 `git reset/clean/restore`、盲目 `git add .`、自动 commit/push。
- 禁止删除、覆盖、整理仓库现有 `data/`；禁止 legacy 数据导入。
- 每个测试批次都使用全新的隔离 `APP_DATA_DIR`、`DATA_ROOT`。
- 用户 `:3000` 当前正在监听；Smoke 建议 Go `18080`、Next.js `3047`。
- 不削弱审批防绕过语义；不输出密码、Token、完整 API Key、Cookie 或业务正文。
- PostgreSQL 保存业务文档、Blob 和审计；SSDB 不作为事实源。
- 生产文件只经 Go Blob 接口；Next.js 和浏览器不承担业务持久化。
- 开发阶段可用隔离 Mock/测试服务，不强制立即使用云服务器，但生产方案不能退回本地存储。

## 4. 已完成，不要重做

- Go documents/blobs、SSDB cache、认证日志、PostgreSQL audit。
- 项目/工作流核心、用户、成员、故事、剧本、资产、管理端→工作台同步。
- 审批原子链、通知、通用多文档 CAS transaction。
- 管理/工作台设计提示词与图片生成、分镜制作、远端人物预检、文本生成历史。
- 视频生成记录、视频幂等预留、生成视频 Blob 与完整/单 Range 播放。
- 工作流文档远端存储及 revision CAS；普通图片/音频远端读取。
- AI 任务规则 capability 级远端 CAS，保留 draft/publish/history/rollback/use-builtin 语义。
- 项目绑定音色远端元数据校验和 `getRemoteAssetAudio()` Blob 读取，无本地回退。
- API Key 掩码、legacy generated-videos 远端封锁、付费测试 guard。
- HTTP Provider 远端暂存 Blob、安全校验和最终转存。
- 生产本地写入审计已完成：未发现新的远端模式可达本地业务写入。

## 5. 验证证据

- 视频远端核心：4 files / 12 tests。
- 视频 Blob、安全、播放：77 tests；既有本地视频安全回归：91 tests。
- 幂等/service：41 tests；本地付费测试：19 tests。
- 工作流远端存储：5/5；普通资产读取与视频 Blob：6/6。
- AI 任务规则/Admin/执行：4 files / 19 tests。
- 远端项目音色/参考媒体：3 files / 32 tests。
- 专项 ESLint、隔离 TypeScript、`git diff --check` 通过。
- Go：`C:\Temp\go1.24.12-portable\go\bin\go.exe test ./...` 通过。
- 未运行真实集成 Smoke，未触碰 `:3000`，未 commit/push。

## 6. 当前阻塞

2026-08-01 交接复核：

- `GO_BACKEND_INTERNAL_URL`、`INTERNAL_API_TOKEN`、`DATABASE_URL`、`TEST_DATABASE_URL`、`SSDB_ADDRESS`、`SD2_PLATFORM_API_URL`、`SD2_PLATFORM_API_KEY` 均未配置。
- Docker CLI 存在，但 `com.docker.service` 为 `Stopped`，daemon 不可用。
- `5432/5433/8888/8080/18080` 均无监听；`:3000` 正在监听。
- 本机没有可直接使用的 PostgreSQL/SSDB；`deploy/compose.remote.yml` 仍需批准的 `SSDB_IMAGE`、数据库凭据和内网 Token。

当前不能诚实完成真实 Go/PostgreSQL/SSDB 集成或 SD2 真机联调。不得猜测地址、凭据、镜像或结果。

## 7. 下一小步

1. 只读复核环境变量、Docker daemon 和 `5432/5433/8888/8080/18080`，不要打印秘密值。
2. 若受控服务可用：使用临时测试数据库、批准的 SSDB、Go `18080` 做最小集成；隔离 `APP_DATA_DIR`、`DATA_ROOT`。
3. 若仍不可用：记录阻塞并继续以下审计，完成一项验证后自动进入下一项：
   - `src/video-generation/outbound-log/video-outbound-txt-log.ts`：远端只输出脱敏 JSON stdout，不写 TXT。
   - `src/app/api/local-voices/*`：远端/生产返回空或拒绝，不读取服务器本地声音目录。
   - `src/video-generation/secure-transfer/safe-download.ts`：文件下载只在 legacy 本地分支可达。
4. 真实集成完成后再运行 G1-R Browser Smoke，Next.js 用非 `3000` 端口并隔离两类数据目录。
5. 仅运营提供真实 SD2 URL/Key 后做真机联调。

## 8. 验证模板

```powershell
$tmp = Join-Path $env:TEMP (ic-remote-test- + [guid]::NewGuid().ToString(N))
$env:APP_DATA_DIR = Join-Path $tmp app-data
$env:DATA_ROOT = Join-Path $tmp data-root
$env:REMOTE_DATA_ONLY = true
npx.cmd vitest run <本小步测试>
npx.cmd eslint <本小步文件>
npx.cmd tsc --noEmit -p <隔离临时 tsconfig>
git diff --check -- <本小步文件与文档>
```

涉及 Go 时从 `backend/` 运行：

```powershell
C:\Temp\go1.24.12-portable\go\bin\go.exe test ./...
```

## 9. 已知无关问题

- `src/ai-config/__tests__/video-paid-gate-routes.test.ts` 有 2 个既有 `403/422` 校验顺序问题，不要改变验证顺序。
- `src/projects/storyboard/api-helpers.ts` 的 `resolveAssetImageStorageKey` 输入缺少必需 `id`，除非接手该域否则不要顺修。
- 全量 TypeScript 可能被既有跨域问题阻断；使用仅覆盖本小步的临时 `tsconfig`。

## 10. 集成参考

- `deploy/compose.remote.yml`
- `backend/internal/config/config.go`
- `backend/internal/app/app.go`
- `backend/internal/migrations/0001_remote_storage.sql`
- `scripts/run-postgres-tests.ts`
- `scripts/smoke-batch-g1-browser.ts`
- `scripts/smoke-batch-g1-api.ts`
- `scripts/lib/smoke-app-data-guard.ts`

本次只更新交接文档并只读复核环境：未运行 Smoke，未触碰或复用用户 `:3000`，未修改 `data/`，未 commit/push。
