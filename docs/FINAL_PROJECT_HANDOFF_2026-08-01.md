# Lumina Story 项目最终交接文档

> 整理日期：2026-08-01  
> 项目：`C:\Users\江城的助手\Downloads\24\infinite-canvas`  
> 分支：`feat/react-flow-migration`  
> HEAD：`a8149a0a6e791d9fc2f2ac431a3773ace821870a`

## 1. 30 秒结论

这是一个基于 Next.js 16、React 19、React Flow 和 Zustand 的 AI 视频创作工作台，覆盖项目管理、故事剧本、资产设计、分镜、视频生成、AI 配置、权限与审批。

主要产品链路和大量远端化改造已经完成。当前主线是将生产业务数据从 Next.js 本地文件迁移到 Go + PostgreSQL + SSDB 内网后端，并确保 `REMOTE_DATA_ONLY` / production 下零本地业务读写。

下一独立任务：审计真实视频 Provider 文件链路，证明远端生产模式只使用内存下载和 Go Blob 转存，不读写本地 `generated-videos`、`.download.tmp` 或最终资产文件。

## 2. 工作区现状与红线

- 本次盘点共 `197` 项 Git 状态：`82` 个修改、`1` 个删除、`114` 个未跟踪项。
- 当前成果明显超过 HEAD，不能只看提交历史判断完成度。
- Dirty 内容包含多阶段代码、测试、Go 后端、部署配置和文档，不得视为垃圾。
- 修改前逐文件阅读当前内容和 diff，不得根据状态列表猜文件归属。

未经用户明确授权，禁止：

- `git reset`、`git clean`、`git restore`
- 盲目 `git add .`
- 删除或整体恢复 `data/`
- 自动 commit 或 push
- `npm run db:legacy:import --apply`

## 3. 技术架构

### Next.js 前端/BFF

- Next.js `16.2.11`、React `19.2.4`
- `@xyflow/react 12.11.2`、Zustand `5.0.14`
- TypeScript 5、Tailwind 4、Zod 4、Vitest 3、Prisma 6

主要目录：

- `src/app`：页面与 Route Handlers
- `src/workflow`：React Flow 视频画布
- `src/projects`：项目与目录
- `src/auth`：登录、角色、权限、成员
- `src/ai-config`：模型连接与 AI 任务规则
- `src/text-generation`：文本生成与积分
- `src/video-generation`：视频 Provider、幂等、安全转存
- `src/persistence`：本地/远端持久化分流

### Go 内网后端

位于 `backend/`：

- API：`backend/cmd/api/main.go`
- 文档与事务：`backend/internal/httpapi/documents.go`、`document_transactions.go`
- Blob：`backend/internal/httpapi/blobs.go`
- PostgreSQL：`backend/internal/postgres/store.go`
- SSDB：`backend/internal/ssdb/client.go`
- 数据库迁移：`backend/internal/migrations/0001_remote_storage.sql`

职责边界：PostgreSQL 是持久化事实源；SSDB 仅作可失效缓存；Go 提供文档 CAS、多文档原子事务和 Blob API；Next.js 通过内网 Token 调用 Go；浏览器不直连 Go/PostgreSQL/SSDB；生产业务数据不得落到 Next.js 文件系统。

### 部署

- 本地 PostgreSQL：`docker-compose.yml`
- 远端内网编排：`deploy/compose.remote.yml`
- Go 镜像：`backend/Dockerfile`

## 4. 启动与验证

```powershell
Set-Location 'C:\Users\江城的助手\Downloads\24\infinite-canvas'
npm install
npm run dev
```

开发服务监听 `0.0.0.0:3000`。

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run db:up
npm run test:postgres
```

Go 测试：

```powershell
Set-Location 'C:\Users\江城的助手\Downloads\24\infinite-canvas\backend'
C:\Temp\go1.24.12-portable\go\bin\go.exe test ./...
```

全量 TypeScript 目前被若干既有跨域错误阻断。专项批次应使用临时隔离 `tsconfig`，不要顺手修无关域。

## 5. 安全默认与环境变量

`.env.example` 中必须保持：

```dotenv
VIDEO_PROVIDER=mock
ALLOW_PAID_GENERATION=false
TEXT_LLM_PROVIDER=mock
```

远端关键配置：

```dotenv
REMOTE_DATA_ONLY=true
GO_BACKEND_INTERNAL_URL=http://api:8080
INTERNAL_API_TOKEN=
SSDB_ADDRESS=ssdb:8888
SSDB_PASSWORD=
```

不得在聊天、文档、日志或提交中暴露完整 API Key、Token、密码、Cookie、passwordHash、请求正文或用户剧本全文。后台 AI 配置不得绕过 `ALLOW_PAID_GENERATION=false`。

## 6. 已完成能力

### 产品与权限

- 登录、角色、权限、成员与导航守卫已实现。
- 工作台 `/app/workspace` 与项目管理 `/app/projects` 已分离。
- 视频画布 `/workflow` 独立，分镜页不自动跳转画布。
- 项目管理写操作要求真实 Owner；非 Owner 的 SYSTEM_ADMIN 也拒绝。
- CARD_ENGINEER 可操作已分配项目的 design/library 资产，但不能进入项目管理业务。
- 工作台不能反向覆盖管理端正式数据。

### 内容与创作链路

- 故事生成与大纲已完成。
- 剧本 TXT/DOCX/MD 与智能分集已完成。
- `script.split.generate` 已 active。
- 资产双模块、按集设计、分镜两步流程、Mock 视频和 React Flow 画布已完成。
- 独立资产匹配页已删除。

### AI 配置与图片线路

- 模型连接、AI 任务规则、单次 Provider 执行计划、管理端双 Tab 已完成。
- 已发布任务规则接入文生图，草稿不进线上。
- API Key 使用 AES-256-GCM 存储；公共响应仅固定掩码加末四位。
- 方舟人物预检与自动 omit 已接线。
- SD2 方言和设计人物校验代码已落地，真机联调未完成。

### 远端数据能力

以下已经实现，不要重复设计：

- Go documents/blobs/auth logs/PostgreSQL audit。
- revision CAS、SSDB 缓存失效、多文档原子事务。
- Blob put/get/delete/copy/existence check。
- 用户、身份、项目成员、项目目录、故事、剧本、资产、设计、审批、通知。
- 管理端→工作区同步与审批原子链路。
- 文本任务历史、积分账户和 reservation reserve/settle/release。
- API 配置、模型连接、AI 任务规则远端存储。
- 视频工作流文档、索引、任务记录和幂等预留。
- 生成视频 Blob、内存下载、完整与单 Range 播放。
- 普通图片、音频和生成视频从 Go Blob 读取。
- 远端 Mock 不复制 `generated-videos` 中间文件。
- 远端出站日志只输出脱敏 JSON stdout，不写本地 TXT。
- Provider 可远端解析项目图片与项目绑定音色。
- legacy `generated-videos` 路由在远程生产模式下已封锁。

## 7. 未完成与优先级

### P0：真实 Provider 文件链路审计

重点文件：

```text
src/video-generation/provider/http-video-provider.ts
src/video-generation/secure-transfer/safe-download.ts
src/video-generation/transfer-video.ts
```

验收目标：`REMOTE_DATA_ONLY` / production 下只使用内存下载并直接转存 Go Blob；不创建或读取 `generated-videos`；不创建 `.download.tmp`；不落最终本地资产。若分流已完整，只补专项测试和文档；若仍有远端可达本地分支，做最小修复，不删除本地开发兼容能力。

### P0：SD2 真机联调

需用真实平台 URL/Key 验证普通上传、真人素材 active、视频任务、结果下载和设计“人物校验”绿盾。参考 `C:\Users\江城的助手\Desktop\Seedance2.0API接口文档.md`；不得把 Key 粘贴到聊天或提交。

### P0：G1-R 浏览器 Smoke

需闭环 extract、edit、save、confirm、stale、empty、cancel、非法 JSON 恢复。API Smoke 不能冒充 Browser Smoke。

### 其他

- PostgreSQL Engine/测试环境尚需实际验证。
- `script.episodes.generate` 与 `script.continue.generate` 仍 planned。
- 剧本/故事 Word 导出仍是 Stub。
- 团队、企业库、展示和指引仍是 Stub。
- PDF 明确不支持，不是待办。

## 8. 测试隔离红线

Vitest、API Smoke、Browser Smoke 必须同时隔离 `APP_DATA_DIR` 与 `DATA_ROOT`：

```powershell
$tmp = Join-Path $env:TEMP ('ic-test-' + [guid]::NewGuid().ToString('N'))
$env:APP_DATA_DIR = Join-Path $tmp 'app-data'
$env:DATA_ROOT = Join-Path $tmp 'data-root'
```

- 每个命令使用独立临时目录。
- 自动化必须拒绝仓库真实 `data/`。
- Smoke 使用非 `3000` 端口。
- 不停止、复用或探测性占用用户 `:3000`。
- 不在真实 `data/` 创建测试项目、用户、Mock 配置或任务。
- 若测试数据进入真实 `data/`，立即停批定位。
- 只删除本批次明确创建并核验过的临时目录。

推荐门禁：

```powershell
npx.cmd vitest run <相关测试>
npx.cmd eslint <相关文件>
npx.cmd tsc --noEmit -p <临时隔离-tsconfig>
git diff --check -- <相关文件>
```

## 9. 已知问题

- 全量 `tsc` 存在既有 storyboard 类型、旧 fixture、transaction mock tuple 等跨域错误。
- `video-paid-gate-routes.test.ts` 有既有 `403`/`422` 校验顺序问题，不要为迁移改变业务顺序。
- `README.md` 当前读取出现中文乱码；编码修复应单独成批。
- `data/` 哈希仅是时间点观测，历史计数不是永久基线。
- 历史数据迁移已取消，PostgreSQL 未来干净起步。
- 目标是生产远端路径零本地业务读写，不是删除全部本地开发/legacy 代码。
- `WORKSPACE_CONFIRM_REQUIRES_APPROVAL` 的绕过必须继续返回 `403`。
- Mock 不得冒充付费能力，planned 不得伪装 active。

## 10. 必读顺序

1. `docs/FINAL_PROJECT_HANDOFF_2026-08-01.md`
2. `docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md`
3. `docs/AGENT_CONTINUE_HANDOFF.md`
4. `docs/H1_CLOSE_HANDOFF_PATCH.md`
5. `docs/CURRENT_PROJECT_MASTER_HANDOFF.md`
6. `docs/SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md`
7. `docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`
8. `docs/AI_TASK_RULES_ARCHITECTURE.md`
9. `docs/GO_REMOTE_BACKEND.md`
10. `docs/CURRENT_CODE_AND_BUTTON_MAP.md`

冲突优先级：当前用户指令和红线 > `AGENTS.md` > 最新专项交接 > 旧总交接。当前代码和当次验证是最终事实来源。

涉及 Next.js 行为前，先阅读当前安装版本 `node_modules/next/dist/docs/`。

## 11. 可直接复制给下一位 Agent

```text
请接手 C:\Users\江城的助手\Downloads\24\infinite-canvas。

先完整阅读 docs/FINAL_PROJECT_HANDOFF_2026-08-01.md、docs/GO_REMOTE_MIGRATION_CONTINUE_HANDOFF.md、docs/AGENT_CONTINUE_HANDOFF.md、docs/H1_CLOSE_HANDOFF_PATCH.md 和 docs/CURRENT_PROJECT_MASTER_HANDOFF.md。

当前分支 feat/react-flow-migration，HEAD a8149a0，工作区约 197 项 Dirty。禁止 reset、clean、restore、盲目 add、删除 data、自动 commit/push。

第一任务：审计 http-video-provider.ts、safe-download.ts、transfer-video.ts，证明 REMOTE_DATA_ONLY / production 下只走内存下载和 Go Blob 转存，不读写 generated-videos、.download.tmp 或最终本地资产。已有分流则只补测试与证据；仍有远端可达本地分支则最小修复。

测试必须隔离 APP_DATA_DIR 与 DATA_ROOT，使用非 3000 端口，不触碰真实 data/，不杀或复用用户 :3000。保持 VIDEO_PROVIDER=mock、ALLOW_PAID_GENERATION=false、TEXT_LLM_PROVIDER=mock。禁止 npm run db:legacy:import --apply。
```
> LATEST UPDATE: read docs/LATEST_BLOBSTORE_HANDOFF_2026-08-02.md first. Independent blobstore code/deployment integration is complete. The next task is real PostgreSQL/SSDB/Go/blobstore integration validation, not another Provider file audit.
