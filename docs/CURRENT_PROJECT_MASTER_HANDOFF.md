本文件是当前项目唯一完整技术交接基线。
事实来源为生成时的当前工作区代码、测试和运行门禁。
旧交接报告仅保留历史追溯价值。

> **状态分层（权威见 [`H1_CLOSE_HANDOFF_PATCH.md`](./H1_CLOSE_HANDOFF_PATCH.md)，含 H2-FINAL-STATUS-PATCH）：**  
> - **H1-CLOSE 总状态 PARTIAL** — 仅因历史真实 `data/` 来源无法完整追溯；  
> - **H1 功能验收 COMPLETE** — TXT 主路径、资产设计、单向同步、权限矩阵、全量门禁均已通过；  
> - **H2-AI-CONTROL：功能验收 COMPLETE + 批次总状态 COMPLETE** — 模型接入、任务规则、单次 Provider 调用、Admin 双 Tab、755 tests、Smoke :3043 29/29、全量门禁；**不以** data 哈希标 PARTIAL；  
> - **data/ 事件 OPEN / NON-BLOCKING** — 历史快照 **844** / `5d645e99…`；VERIFY 观测 **847** / `2b51d433…`（均**非**永久固定/干净基线）；真实 `data/` 为在用业务库，`:3000` 合法操作可使哈希正常变化；核心验收为 **`APP_DATA_DIR` 隔离**；见补丁第 0 / 9 节。  
> 以下第 0 章起凡与补丁冲突者，以补丁为准。

---

## 第 0 章 — 元数据与基线快照

| 项 | 值 |
|----|-----|
| 文档生成时间 | 2026-07-29（H2-FINAL-STATUS-PATCH）Asia/Shanghai (+08:00) |
| H2 功能验收 | **COMPLETE** |
| H2 批次总状态 | **COMPLETE**（AI 控制面 + 门禁 + 浏览器 Smoke；不以 data 哈希 PARTIAL） |
| 产品名称 | Lumina Story（Lumina Story / 分镜创作工作台） |
| 代码路径 | `c:\Users\江城的助手\Downloads\24\infinite-canvas` |
| Git 分支 | `feat/react-flow-migration` |
| Git HEAD | `a8149a0a6e791d9fc2f2ac431a3773ace821870a`（工作区 Dirty，含 H1/H1-CLOSE 未提交改动） |
| 工作区状态 | **Dirty: YES**（`git status --short` 约 **129** 行） |
| H1 总状态 | **PARTIAL**（仅 data/ 追溯） |
| H1 功能验收 | **COMPLETE** |
| data/ 事件 | **OPEN / NON-BLOCKING**（不影响 H2 COMPLETE；不阻止后续开发） |
| Node.js | v24.18.0 |
| npm | 11.16.0 |
| Next.js | 16.2.11 |
| React / React DOM | 19.2.4 |
| Prisma | 6.19.0 |
| Vitest | ^3.2.4 |
| TypeScript | 5.9.3（`package.json` 为 `^5`，锁定版本以 lockfile 为准） |
| Zod | 4.4.3 |
| Zustand | 5.0.14 |
| @xyflow/react | 12.11.2 |
| `PERSISTENCE_DRIVER` 默认 | `file`（`.env.example`） |
| `VIDEO_PROVIDER` 默认 | `mock` |
| `ALLOW_PAID_GENERATION` 默认 | `false` |
| `TEXT_LLM_PROVIDER` 默认 | `mock` |
| `TEST_DATABASE_URL` | 仅存在于 `.env.example`；当前 shell **unset** |
| Docker Client | 29.6.1 |
| Docker Engine | **未完全验证**（`docker info` 不完整；历史记录：Engine 常不可用） |
| 开发端口 3000 | H1-CLOSE Smoke **未触碰**；验收用 **3042** |
| `data/` 历史快照（仅追溯） | fileCount **844**；sha256 **`5d645e996eb87a7f1ea36de6d10d9f8a4bd411ca61d1991fa2d84458afe6ffb9`** |
| `data/` VERIFY 观测快照 | fileCount **847**；sha256 **`2b51d4336777093f8d16a81803ec66f77db0860382b533413eeceb8fbc3722c9`**（**非**永久固定/干净基线） |
| `data/` 原则 | 在用业务库；`:3000` 合法操作可改文件数/哈希；**不**再要求后续批次钉死某一全目录哈希；硬门禁仅维护窗口 |
| H2 浏览器 Smoke | :**3043**；隔离 `APP_DATA_DIR`；报告 `C:\Temp\h2-browser-report.json`；**29/29**；未触碰 :3000；**未**污染真实 `data/` |
| 哈希脚本 | `npx tsx scripts/hash-app-data.ts`（时间点观测；非日常 COMPLETE 唯一阻断） |
| data 取证 | `C:\Temp\h1-close-forensics\`、`C:\Temp\h2-data-forensics\`、`C:\Temp\h2-anchor-verify-report.md`；禁止盲删；845→847 增量为项目 `script.json` + `workspace/snapshot.json`（非 ai-* 配置） |
| 遗留 Smoke 目录 | `C:\Temp\ic-smoke-00ba98682c9fbb90-1zDgaS`（H1-CLOSE）；旧目录仍可能存在 |
| `npm ls --depth=0` | clean；无 missing/invalid/extraneous；`jszip` + `fast-xml-parser` 仅用于 DOCX 解析 |

### 工作区改动分类（摘要）

完整 120 行列表见附录 A（来源 `C:\Temp\ic-handoff-git-status.txt`）。按类别：

| 类别 | 说明 |
|------|------|
| 配置/工具链 | `.env.example`、`.gitignore`、`README.md`、`package.json`、`tsconfig.json`、`vitest.config.ts`、`vitest.setup.ts`、`docker-compose.yml` |
| 认证/权限 | `src/auth/*`、`src/middleware.ts`、登录页删除、导航 API |
| 视频生成 | `src/video-generation/*`（Provider、idempotency、secure-transfer、测试） |
| React Flow 工作流 | `src/workflow/*`（Editor、节点、autosave、document-history） |
| 项目管理/工作台 | `src/projects/*`、`src/app/app/*`、`src/shell/*`、`src/home/*` |
| 持久化/Prisma | `prisma/`、`src/persistence/*` |
| AI 配置中心 | `src/ai-config/*`、admin API configs |
| 文本生成 | `src/text-generation/*` |
| 运行时数据（未跟踪） | `data/object-storage/`、`data/project-members.json`、`data/projects/` 等 |
| 文档/脚本 | `docs/*`、`scripts/*` |

### 安全红线（未提交工作区）

**禁止**：`git reset` / `git clean` / `git checkout -- .` / `git restore .` / 盲目 `git add .` / 删除 `data/` / `npm run db:legacy:import --apply` / 自动 commit / 自动 push。

测试必须隔离 `APP_DATA_DIR`（`vitest.setup.ts` 每 worker `mkdtemp`）。不得修改真实 `.env` 中 `VIDEO_PROVIDER` / `ALLOW_PAID_GENERATION` 默认策略。

---

## 第 1 章 — 产品完整流程

```
首页 `/`
  → 登录（`/?login=1`，HeaderLoginPanel → POST /api/auth/login）
  → 应用门户 `/app`（AuthenticatedAppShell）
  → 平台工作台 `/app/workspace`（可访问项目列表）
       → 工作台项目 `/app/workspace/projects/[projectId]`（阶段：资产 / 分镜 / 视频；**无剧本**）
       → 工作台资产 `/app/workspace/projects/[projectId]/assets`
            → Owner → redirect design
            → CARD_ENGINEER → 可进 design + library（H1：工作台资产设计已对 CE 开放）
            → 双模块 nav：design + library（Owner + 已分配 CE）
  → 项目管理 `/app/projects`（仅 SYSTEM_ADMIN 创建；创建后**仅实际 ownerId** 可操作项目内容）
       → 项目详情 `/app/projects/[projectId]`（阶段总览 + 成员）
       → 故事 `/app/projects/.../story` 或 剧本 `/app/projects/.../script`
       → 管理资产 `/app/projects/.../assets` → **redirect** → `/assets/design`
            → 资产设计确认 `/app/projects/.../assets/design`
            → 资产库 `/app/projects/.../assets/library`
       → 分镜创作 `/app/projects/.../storyboard`
            → 单镜 / 整集视频生成（storyboard-workspace API）
            → 镜头预览 + 历史版本
  → React Flow 视频制作画布 `/workflow?projectId=`（独立于 `/app` 壳）
```

### 三个必须区分的表面

| 表面 | 路由前缀 | 说明 |
|------|----------|------|
| 平台工作台 | `/app/workspace…` | 被分配/拥有的项目；CARD_ENGINEER 主要入口；无成员/剧本 |
| 项目管理 | `/app/projects…` | 创建与全流程管理；CARD_ENGINEER 布局拦截 |
| 视频画布 | `/workflow` | React Flow；**不是**工作台；分镜页 **不会** 自动跳转画布 |

---

## 第 2 章 — 目录架构

```
infinite-canvas/
├── data/                          # 运行时 JSON + 二进制（开发期存档；勿删）
│   ├── users.json
│   ├── project-members.json
│   ├── credits.json
│   ├── projects/{projectId}.json
│   ├── projects/{projectId}/drafts/
│   ├── generations/
│   ├── workflows/
│   ├── mock/
│   ├── generated-videos/
│   └── object-storage/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/                       # CLI：auth、hash、smoke seed、legacy import、postgres tests
├── docs/                          # 交接与审计文档
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── page.tsx               # 首页
│   │   ├── app/                   # /app/* 应用壳
│   │   ├── workflow/              # /workflow React Flow
│   │   └── api/                   # 67 个 route.ts
│   ├── auth/                      # 用户、session、权限、API 配置 UI
│   ├── ai-config/                 # Capability registry、resolver、加密
│   ├── home/                      # 首页组件
│   ├── shell/                     # AppShell、导航、ModulePlaceholder
│   ├── projects/                  # 故事/剧本/资产/分镜/工作台
│   ├── persistence/               # data-root、Prisma repos、storage providers
│   ├── text-generation/           # SSE 文本生成、credits、providers
│   ├── video-generation/          # 视频 job、provider、idempotency
│   └── workflow/                  # React Flow 编辑器、节点、store
├── vitest.config.ts
├── vitest.postgres.config.ts
├── vitest.setup.ts
├── docker-compose.yml             # postgres + postgres-test
└── package.json
```

核心约定：`src/app/api/**/route.ts` 为 REST 入口；业务逻辑在 `src/projects/`、`src/auth/` 等模块；`server-only` 标记服务端专用模块。

---

## 第 3 章 — 路由表（全部页面）

| 路由 | 页面文件 | 用途 | 角色 | 状态 | 服务端数据 |
|------|----------|------|------|------|------------|
| `/` | `src/app/page.tsx` → `HomePage` | 首页 + 登录入口 | 公开 | 真实 | 否 |
| `/login` | （已删除） | middleware 重定向 → `/?login=1` | — | — | — |
| `/app` | `src/app/app/page.tsx` | 门户空白页 | 登录用户 | 真实壳 | 导航 API |
| `/app/workspace` | `…/workspace/page.tsx` | 工作台项目列表 | 有可访问项目者 | 真实 | `GET /api/workspace/projects` |
| `/app/workspace/projects/[id]` | `…/workspace/projects/[projectId]/page.tsx` | 工作台项目阶段 | `requireWorkspaceProjectAccess` | 真实；**无剧本** | `GET /api/workspace/projects/[id]` |
| `/app/workspace/projects/[id]/assets` | `…/assets/page.tsx` | 工作台资产入口 | `requireWorkspaceAssetAccess` | redirect：Owner/Admin→design；CE→library | — |
| `/app/workspace/projects/[id]/assets/library` | `…/assets/library/page.tsx` | 工作台资产库 | 同上 | `WorkspaceAssetsPage` + `AssetManagementWorkspace` | assets-draft |
| `/app/workspace/projects/[id]/assets/design` | `…/assets/design/page.tsx` + design layout | 工作台资产设计确认 | `assertWorkspaceAssetDesignPage`（**CE 可进入**，同资产库门禁） | 同管理端设计 UI；写 workspaceLocal | snapshot + workspaceLocal |
| `/app/workspace/projects/[id]/storyboard` | `…/storyboard/page.tsx` | 工作台分镜 | `assertWorkspaceStoryboardPage` | 真实 | storyboard-workspace |
| `/app/projects` | `…/projects/page.tsx` | 项目管理列表 | `requireProjectManagementAccess` | 真实 | `GET /api/projects` |
| `/app/projects/[id]` | `…/projects/[projectId]/page.tsx` | 管理详情+成员 | `requireProjectManagementProjectAccess` | 真实 | projects + members |
| `/app/projects/[id]/story` | `…/story/page.tsx` | 故事创作 | 同上 | 故事/大纲已接 text-generations；剧集/续写 planned | story-draft + script-draft.outlineText |
| `/app/projects/[id]/script` | `…/script/page.tsx` | 剧本上传 | 同上 | TXT/DOCX/MD 真实；PDF **不支持**；AI 分集 Stub | script-draft |
| `/app/projects/[id]/assets` | `…/assets/page.tsx` | 管理资产入口 | 同上 | **redirect → `/assets/design`** | — |
| `/app/projects/[id]/assets/design` | `…/assets/design/page.tsx` | 资产设计确认 | 同上 | `EpisodeAssetDesignWorkspace` + `AssetModuleNav` | episode-asset-designs |
| `/app/projects/[id]/assets/library` | `…/assets/library/page.tsx` | 资产库 | 同上 | `AssetManagementWorkspace` in `ProjectAssetsShell` | assets-draft |
| `/app/projects/[id]/storyboard` | `…/storyboard/page.tsx` | 分镜创作 | storyboard access | 真实 | storyboard-workspace |
| `/app/projects/[id]/breakdown` | `…/breakdown/page.tsx` | 旧拆解 | 管理布局 | **Redirect → assets** | — |
| `/workflow` | `src/app/workflow/page.tsx` | React Flow 画布 | `requireVideoCanvasAccess` | 真实 | workflow + generations |
| `/app/team` | `…/team/page.tsx` | 团队 | 壳 | **Stub** `ModulePlaceholder` | 否 |
| `/app/enterprise-assets` | `…/enterprise-assets/page.tsx` | 企业素材 | 壳 | **Stub** | 否 |
| `/app/showcase` | `…/showcase/page.tsx` | 作品展示 | 壳 | **Stub** | 否 |
| `/app/guide` | `…/guide/page.tsx` | 创作指引 | 壳 | **Stub** | 否 |

---

## 第 4 章 — 权限系统与矩阵

### 4.1 有效项目角色（`EffectiveProjectRole`）

优先级（`src/auth/effective-role.ts` → `resolveEffectiveProjectRole`）：

1. **SYSTEM_ADMIN** — `AuthUser.role === "admin"`
2. **PROJECT_OWNER** — `Project.ownerId === userId`（**不**从 `ProjectMember` 读）
3. **CARD_ENGINEER** — `ProjectMember.role === "CARD_ENGINEER"`
4. **NONE**

- 缺省/非法用户角色 → **USER**（系统级），绝不为 SYSTEM_ADMIN
- 项目主理人 **不**在 `ProjectMember` 中重复保存 OWNER
- 无自动创建默认管理员（`no-default-admin-bootstrap.test.ts`）
- 显式提升 CLI：`npm run auth:grant-system-admin -- --username …`
- **未发现**前端 body 提权路径

### 4.2 统一权限函数

| 函数 | 路径 |
|------|------|
| `resolveEffectiveProjectRole` / `resolveProjectAccess` | `src/auth/effective-role.ts` |
| `requireAuthenticatedUser` | `src/auth/require-access.ts` |
| `requireSystemAdmin` | 同文件 |
| `requireProjectManagementAccess` | 同文件 |
| `requireProjectOwnerOrSystemAdmin` | 同文件 |
| `requireWorkspaceProjectAccess` / `requireWorkspaceAssetAccess` | 同文件 |
| `requireStoryboardAccess` / `requireVideoCanvasAccess` | 同文件 |
| `requireProjectManagementProjectAccess` | 同文件 |
| `requireVideoCanvasAccessForGeneration` | 同文件 |
| 页面断言 | `src/auth/page-guards.ts` |

`workspaceFeaturesForRole`：ADMIN/OWNER → `assets|storyboard|video`；CARD_ENGINEER → `assets` only。

### 4.3 权限矩阵

| 能力 | SYSTEM_ADMIN | PROJECT_OWNER | CARD_ENGINEER | NONE |
|------|:---:|:---:|:---:|:---:|
| 工作台 | Y | Y | Y（已分配） | N |
| 项目管理列表 | Y | Y（有拥有项目） | N | N |
| 创建项目 | Y | N | N | N |
| 工作台资产库 | Y | Y | Y | N |
| 资产设计确认 | Y | Y | N | N |
| 剧本/故事 | Y | Y | N | N |
| 分镜 | Y | Y | N | N |
| 视频生成/画布 | Y | Y | N | N |
| 成员管理 | Y | Y | N | N |
| 系统角色管理 | CLI only | N | N | N |

### 4.4 CE 设计页拦截

`assertWorkspaceAssetDesignPage`（`page-guards.ts`）：**与资产库相同**，已分配 CE 可进入 design（H1）。

项目管理项目页/API：`requireActualProjectOwner`（非 owner 的 SYSTEM_ADMIN **拒绝**）。  
`/app/workspace/projects/{id}/assets/library?denied=design`。

---

## 第 5 章 — 认证、用户、项目、成员链路

### 5.1 认证

- Session cookie：`ic_session`（`src/auth/session.ts`）
- 登录：`POST /api/auth/login` → 校验 `users.json`（scrypt 密码）
- 登出：`POST /api/auth/logout`
- 当前用户：`GET /api/auth/me`
- 导航：`GET /api/auth/navigation`（按角色过滤）
- Profile：`PATCH /api/auth/profile`（仅 `displayName`）
- 密码：`PATCH /api/auth/password`
- Middleware（`src/middleware.ts`）：除 `/`、`/api/auth/*`、静态资源外均需有效 session

### 5.2 用户存储

- 文件：`data/users.json`（`StoredUser` 含 passwordHash/Salt，**禁止写入文档**）
- 类型：`AuthUser`（id, username, role, displayName, timestamps）

### 5.3 项目

- 列表/创建/详情：`GET/POST /api/projects`、`GET/PATCH /api/projects/[id]`
- 创建：仅 SYSTEM_ADMIN（`canCreateProject`）；`ownerId` = 当前用户
- 幂等：`idempotencyKey`（file：`data/project-create-idempotency/`；PG：字段）
- 可选 PG：`PERSISTENCE_DRIVER=postgres` 时项目 list/create/get/patch 走 Prisma

### 5.4 成员

- API：`/api/projects/[projectId]/members`（GET/POST/PUT/DELETE）
- 权限：`requireProjectOwnerOrSystemAdmin`
- 存储：`data/project-members.json`
- 仅可分配 **CARD_ENGINEER**；OWNER 不在 members 表

---

## 第 6 章 — 故事模块

| 项 | 事实 |
|----|------|
| 页面 | `StoryCreationWorkspace`（`/app/projects/[id]/story`） |
| 草稿 | `drafts/story.json`（`story-draft` API） |
| 文本生成 | ✅ `POST .../text-generations`（SSE）；`outputKind=story` → `story.generate` |
| 预览确认 | `StoryGenerationPreview` → 「应用到故事草稿」→ `PUT story-draft` |
| 取消生成 | abort + `POST .../text-generations/[id]/cancel` |
| 大纲模式 | 「讨论大纲」→ `outputKind=script_outline` → `script.outline.generate` |
| 直生剧集 | UI 骨架保留；capability **planned**；服务端 `AI_CAPABILITY_PLANNED` |
| 续写 | **planned** Stub；按钮 disabled / toast |
| 导出 | `exportDocuments()` **NON_AI Stub**；不生成 Word |
| 权限 | OWNER/ADMIN only |
| 积分 | `requiresCredits: true`；走 `credits.json` reserve/settle |

---

## 第 7 章 — 剧本模块

### 7.1 页面与草稿

- 页面：`ScriptCreationWorkspace`（`/app/projects/[id]/script`）
- 草稿：`drafts/script.json`（`sourceText` / `sourceImport` / `episodes` / `outlineText`）
- API：`GET/PUT /api/projects/[projectId]/script-draft`

### 7.2 TXT 导入

- `POST .../script-draft/import-txt`：仅预览，不改 draft
- 编码：UTF-8 / UTF-8 BOM / UTF-16 LE·BE / GB18030
- 确认后 `PUT script-draft`

### 7.3 DOCX 导入

- `POST .../script-draft/import-docx`：内存 ZIP/XML（`jszip` + `fast-xml-parser`）
- 仅主文档正文；图片/页眉页脚/批注忽略；宏拒绝
- 上限 10 MiB

### 7.4 Markdown 导入

- `POST .../script-draft/import-markdown`；`.md`/`.markdown`
- `script-markdown-normalizer` → 共用 `script-txt-parser`
- `sourceImport.format=md`

### 7.5 分集规则

- 仅明确标题行（第N集/回、EP/EPISODE）
- 无标题 → **1 集**；不按字数切割
- TXT/DOCX/MD 共用 parser

### 7.6 内容变更失效

- `PUT script-draft` 内容指纹变化 → `invalidateAfterScriptChange`
- 相同语义内容跨格式不重复失效

### 7.7 PDF — 产品明确不支持

- file input **不含** `.pdf`
- **不存在** `import-pdf` 路由
- 用户需转换为 TXT / DOCX / Markdown
- **不要**写成待开发项

### 7.8 Planned / Stub

| 功能 | 状态 |
|------|------|
| `script.episodes.generate`（根据大纲生成剧集） | **planned**（E2 暂停）；UI wired；服务端 blocks `AI_CAPABILITY_PLANNED` |
| `script.continue.generate`（剧集续写） | **planned** Stub |
| `exportScriptToWord` | **NON_AI Stub**；预留函数，不生成文件 |

---

## 第 8 章 — 资产系统总览（三存储）

| 存储 | 路径 | 用途 | 权限 |
|------|------|------|------|
| 资产库元数据 | `projects/{id}/drafts/assets.json` | Character/Scene/Prop/Audio CRUD | `requireWorkspaceAssetAccess` |
| 按集资产设计 | `projects/{id}/drafts/episode-asset-designs.json` | AI/手动设计项、确认前草稿 | `requireProjectManagementProjectAccess` |
| 工作流素材 | `APP_DATA_DIR/assets/` | 画布 `POST /api/assets` | 弱/无登录（注意安全） |

二进制：

- 图片：`drafts/asset-images/{assetId}`（PNG/JPEG/WebP；10 MiB）
- 音频：`drafts/asset-audio/{assetId}`（MP3/WAV/OGG；50 MiB；HTTP Range）

工作台与管理 **分离**：管理正式 drafts vs 工作台 `snapshot.json` + `workspaceLocal`；**单向**管理→工作台。

---

## 第 9 章 — 按集资产设计（Episode Asset Design）

### 9.1 双模块路由

| 模块 | 管理端路由 | 工作台路由 | 组件 |
|------|-----------|-----------|------|
| 设计确认 | `/app/projects/[id]/assets/design` | `/app/workspace/projects/[id]/assets/design` | `EpisodeAssetDesignWorkspace` |
| 资产库 | `/app/projects/[id]/assets/library` | `/app/workspace/projects/[id]/assets/library` | `AssetManagementWorkspace` |
| 入口 redirect | `/assets` → design | `/assets` → design（Owner/Admin）或 library（CE） | — |
| Shell/Nav | `ProjectAssetsShell` + `AssetModuleNav` | 同上（CE 仅 library nav） | — |

### 9.2 能力注册

- `asset.episode-design.generate` · **active**
- `allowedRoles`: ADMIN/OWNER（registry 中为 SYSTEM_ADMIN / PROJECT_OWNER）
- Profile slot: `episode-asset-design-text`
- `requiresCredits: true`；supportsStreaming/Cancel: true

### 9.3 生成链路

1. 「提取本集资产」/「重新提取」→ `streamStoryGeneration({ outputKind: "episode_asset_design", episodeId })`
2. `POST .../text-generations`（SSE）
3. 完成 → `POST .../asset-designs/episodes/[episodeId]/apply-generation`
4. 输入：单集正文（`script.json` episodes）；**非**全剧本

### 9.4 手动添加

- 复用资产库 `CharacterCreateDialog` / `SceneCreateDialog` / `PropCreateDialog` / `AudioCreateDialog`
- 写入设计草稿 `resolution=create_new`；**确认前不入库**
- pending 图片/音频仅客户端 blob；确认后补传

### 9.5 保存与确认

- 「保存本集资产」→ `PUT .../asset-designs/episodes/[episodeId]`
- 「确认本集资产」→ `POST .../confirm`
- Resolution：`pending` | `create_new` | `link_existing` | `ignore`
- `create_new` → 合并入 `assets.json`
- `atomicWriteTwoJsonFiles`（`confirm.ts`）：原子双文件 commit

### 9.6 Stale 检测

- `getScriptEpisodeContentFingerprint`（`fingerprint.ts`）
- 剧本内容变化 → status `stale`

### 9.7 G1-UI 验收项（代码已验证 COMPLETE）

| 项 | 状态 |
|----|------|
| 「查看资产库」从设计工作区移除 | ✅ REMOVED（nav 仍有「资产库」模块入口） |
| 「查看本集剧本」 | ✅ PRESENT（`data-testid="ead-view-script"`） |
| 左面板宽度 | ✅ `clamp(230px, 21vw, 280px)` |
| 右侧卡片样式 | ✅ `amw-panel` / detail styles |
| 按钮文案 | ✅ 提取/重新提取、取消生成、保存本集资产、确认本集资产、手动添加 |

测试：`episode-asset-design-ui.test.ts`、`asset-module-routes.test.ts`。

### 9.8 状态机（`EpisodeAssetDesignStatus`）

`not_started` → `generating` → `review` → `confirmed`；异常：`stale` / `failed`。

### 9.9 API 端点

| Method | Path |
|--------|------|
| GET | `/api/projects/[id]/asset-designs` |
| GET/PUT | `/api/projects/[id]/asset-designs/episodes/[episodeId]` |
| POST | `/api/projects/[id]/asset-designs/episodes/[episodeId]/apply-generation` |
| POST | `/api/projects/[id]/asset-designs/episodes/[episodeId]/confirm` |

### 9.10 非目标

- **不**自动调用 image/audio/video 模型
- CARD_ENGINEER **可**访问工作台设计 API / 设计页；**不可**访问项目管理 design
- 项目管理写操作仅 `requireActualProjectOwner`

### 9.11 验证级别

| 范围 | 级别 |
|------|------|
| Unit/route tests | ✅ extensive（`episode-design/__tests__/*`、`asset-module-routes`、`episode-asset-design-ui`、`confirm` 等） |
| Browser UI Smoke（Assets UI Parity, 2026-07-28, :3040） | ✅ Owner dual-nav；历史曾写 CE design denied — **已被 H1 覆盖** |
| Browser UI Smoke（H1-CLOSE, 2026-07-29, :3042） | ✅ 现场 TXT 上传闭环 + 一键复制 + CE 单向隔离 + 陌生用户/非 owner Admin 拒绝 |
| Full G1-R browser（extract/edit/save/confirm/stale/empty/cancel/illegal JSON recover） | **未完成完整浏览器 UI 验收** — 仅有 API/unit 证据 |
| API smoke ≠ browser smoke | **必须区分** |

---

## 第 10 章 — 资产库（Character / Scene / Prop / Audio）

| 类型 | 元数据字段 | 二进制 |
|------|-----------|--------|
| Character | `CharacterAsset` + `imageFileName`/`imageMimeType` | `PUT/GET/DELETE .../assets-draft/images/[assetId]` |
| Scene | 同上 | 同上 |
| Prop | 同上 | 同上 |
| Audio | `AudioAsset` + `fileName`/`mimeType` | `PUT/GET/DELETE .../assets-draft/audio/[assetId]` |

- 持久化剥离 `imageObjectUrl` / `objectUrl`（仅内存预览）
- 新建资产：先 `PUT assets-draft` 再上传二进制
- 组件：`AssetManagementWorkspace`、`CharacterList`、`AssetImageUpload`、`AssetAudioUpload`、`AssetAudioPlayer`
- CreateDialogs：Character/Scene/Prop/Audio

---

## 第 11 章 — AI 配置中心与 Capability 全表

### 11.1 配置中心（H2 扩展）

- UI：`ApiManagePanel`（SYSTEM_ADMIN）— 双 Tab：
  - **模型接入配置**（`data-testid="ai-config-tab-models"`）→ `ModelConnectionsTab`
  - **功能绑定与任务规则**（`data-testid="ai-config-tab-rules"`）→ `CapabilityRulesTab`
- **模型接入**：`GET/POST /api/admin/model-connections`、`GET/PATCH/DELETE .../[connectionId]`、`POST .../test`
- **槽位绑定**：`GET/PUT /api/admin/ai-model-bindings`（`profileSlot` → `modelConnectionId`）
- **任务规则**：`GET /api/admin/ai-task-rules`、`GET .../[capabilityId]`、`PUT .../draft`、`POST .../check|publish|rollback|use-builtin|import-markdown|test-run`、`GET .../versions`
- 旧版 Profile API（仍可用）：`GET/PUT /api/admin/api-configs`、`POST .../test`
- 可用性：`GET /api/ai-capabilities/availability`（登录用户，无 secret）
- Secret：AES-256-GCM（`AI_CONFIG_ENCRYPTION_KEY`）；`modelConnection.apiKey` 与 legacy `generation-api-configs.json` 共用加密 envelope `enc:v1:`
- 存储：
  - `ai-model-connections.json` — 模型连接 + `slotBindings`
  - `ai-task-rules.json` — 每 capability 的 draft / published 版本链
  - `generation-api-configs.json` — legacy profile 配置（v2）
- 运行时：`resolveAiExecutionPlan`（`src/ai-config/execution-plan.ts`）在 `run-generation.ts` 中组装 **四层 prompt** 并 **单次** Provider 调用；生成 job 写入 H2 元数据字段（见 `TextGenerationJob`）
- 架构详解：`docs/AI_TASK_RULES_ARCHITECTURE.md`

### 11.2 modelConnection vs profileSlot

| 概念 | 说明 |
|------|------|
| **profileSlot** | Capability 注册表中的固定槽位 ID（如 `script-split-text`）；capability binding 指向槽位 |
| **modelConnection** | 管理员创建的可复用模型接入记录（mock/http/aliyun-wan27）；含 endpoint、modelId、加密 apiKey |
| **绑定关系** | `ai-model-connections.json` 的 `slotBindings[profileSlot] = modelConnectionId`；运行时 `resolveConnectionForSlot` 解析 |

任务规则（`ai-task-rules.json`）与模型接入 **独立**：规则定义「做什么」，modelConnection 定义「用什么模型」。

### 11.3 任务规则生命周期

draft（编辑/导入 Markdown）→ check（静态校验）→ publish（版本号递增）→ rollback（回退到历史版本）→ use-builtin（恢复内置规则）。`planned` capability **不可**通过规则配置激活。

### 11.4 Capability 全表（`src/ai-config/capabilities.ts`）

| capabilityId | label | status | modality | requiresCredits | paidRisk | profile slot |
|--------------|-------|--------|----------|-----------------|----------|--------------|
| story.generate | 故事生成 | active | text | yes | possible | story-text |
| script.outline.generate | 剧本大纲生成 | active | text | yes | possible | script-outline-text |
| script.episodes.generate | 根据大纲生成剧集 | **planned** | text | yes | possible | null |
| script.continue.generate | 剧集续写 | **planned** | text | yes | possible | null |
| asset.episode-design.generate | 单集资产设计生成 | active | text | yes | possible | episode-asset-design-text |
| image.character.generate | 角色外貌生成 | active | image | no | possible | character-image |
| audio.character-voice.generate | 角色声音生成 | active | audio | no | possible | character-voice |
| image.scene.generate | 场景画面生成 | active | image | no | possible | scene-image |
| video.storyboard-shot.generate | 单镜视频生成 | active | video | yes | paid | video-shot |
| video.storyboard-episode.generate | 整集视频生成 | active | video | yes | paid | video-shot |
| video.workflow-node.generate | 工作流视频生成 | active | video | yes | paid | video-shot |

审计详情：`docs/AI_BUTTON_API_CONFIG_AUDIT.md`。

---

## 第 12 章 — 文本生成

- 入口：`POST /api/projects/[projectId]/text-generations`（SSE：meta/delta/usage/done/error）
- 编排：`src/text-generation/run-generation.ts`
- Provider：`TEXT_LLM_PROVIDER=mock|dashscope`（默认 mock）
- 取消：`POST .../text-generations/[generationId]/cancel`
- 模型列表：`GET /api/text-models`（publicKey 映射，无 secret）
- outputKind → capabilityId：`outputKindToCapabilityId()`（story / script_outline / script_episodes / episode_asset_design）
- 积分：reserve → settle/release（`credits.json`）
- 速率限制：`TEXT_GEN_RATE_LIMIT_PER_MINUTE`（默认 10）

---

## 第 13 章 — 积分

| 域 | 存储 | 扣费 |
|----|------|------|
| 文本生成 | `data/credits.json` | ✅ reserve/settle/release |
| 视频生成（registry `requiresCredits: true`） | idempotency file-store reserve | **不**写 `credits.json` |
| 查询 | `GET /api/credits` | — |

- 开发默认余额：`TEXT_CREDITS_DEV_BALANCE`（默认 10000）
- 定价：`TEXT_POINTS_PER_1K_INPUT/OUTPUT`（DEV 测试倍率）
- **已知不一致**：registry 声明 video capabilities `requiresCredits: true`，但 `video-generation` 模块 **不** deduct `credits.json`

---

## 第 14 章 — 分镜创作

| 需求 | 状态 |
|------|------|
| 两步：选择剧集 → 分镜创作 | ✅ `CreationStep = 1\|2` |
| 独立资产匹配页 | 🗑️ UI 已删；legacy API deprecated |
| 左侧剧集栏 | ✅ 紧凑「第N集」+ 分页 10 |
| 扁平镜号列表 | ✅ `listFlatShots` |
| 场次标题显示 | ❌ 数据有 `sceneTitle`，卡片 UI **未渲染** |
| 独立展开 / 多开 | ✅ |
| shotSummary / 镜头内容 UI | 🗑️ 已删 |
| 视频预览位 | ✅ `ShotVideoPreview` |
| 版本标志 | ✅ 「版本 N」 |
| 提示词保存/恢复/锁定/重生成 | ✅ |
| 人工修改覆盖确认 | ✅ `manuallyEdited` + confirm |
| 人物/道具/场景素材 | ✅ gallery + picker |
| LINKED / UNRESOLVED / NOT_REQUIRED | ✅ |
| 本集确认 | ✅ → `storyboard_done` |
| 修改后确认失效 | ✅ stale 机制 |
| 无场景预检 | ✅ `shot-video-precheck.ts` + dialog |

持久化：`drafts/storyboard-production.json`。

---

## 第 15 章 — 单镜与整集视频生成

| 项 | 事实 |
|----|------|
| 单镜按钮 | `ShotVideoGenerationButton` |
| 整集按钮 | `EpisodeVideoGenerationButton`「一键生成本集视频」 |
| 启用条件 | 本集 `storyboard_done` + 权限 + 提示词；场景 **点击后预检** |
| 单镜 API | `POST .../shots/[shotId]/generate-video` |
| 整集 API | `POST .../storyboard/generate-videos` |
| 并发 | `STORYBOARD_VIDEO_CONCURRENCY = 2` |
| 幂等 | 客户端 UUID；批次内 `${key}:${shot.id}` |
| 跳过已成功 | 默认跳过 completed 且非 stale |
| 历史 | `videoHistoryGenerationIds` 只增不删 |
| Mock/付费 | 默认 mock；`aliyun-wan27` 需 `confirmPaidGeneration` + `ALLOW_PAID_GENERATION` |
| CARD_ENGINEER | `requireVideoCanvasAccess` **禁止** |

Generation job 状态：`validating` → `submitting` → `queued` → `processing` → `downloading` → `completed|failed|cancelled|…`

---

## 第 16 章 — React Flow 工作流

- 路由：`/workflow?projectId=` → `requireVideoCanvasAccess` → `WorkflowCanvasClient` → `WorkflowEditor`
- 节点类型：character / scene / videoShot / image / text / audio / prop
- 持久化：`workflows/{projectId}.json`（`GET/PUT /api/workflow`）
- 生成：`POST /api/generations`、character-image、scene-image、character-voice、video-shot
- Mock 视频、参考素材 Drawer、`Accept-Ranges` 播放
- Store：Zustand（`src/workflow/store.ts`）
- **分镜页不自动跳转画布**

---

## 第 17 章 — API 路由全表（67 routes）

### 17.1 认证与用户

| Method | Path | 权限 |
|--------|------|------|
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | session |
| GET | `/api/auth/me` | session |
| GET | `/api/auth/navigation` | session |
| PATCH | `/api/auth/profile` | session |
| PATCH | `/api/auth/password` | session |

### 17.2 积分与 AI 配置

| Method | Path | 权限 |
|--------|------|------|
| GET | `/api/credits` | session |
| GET | `/api/text-models` | session |
| GET | `/api/ai-capabilities/availability` | session |
| GET/PUT | `/api/admin/api-configs` | SYSTEM_ADMIN |
| POST | `/api/admin/api-configs/test` | SYSTEM_ADMIN |
| GET/POST | `/api/admin/model-connections` | SYSTEM_ADMIN |
| GET/PATCH/DELETE | `/api/admin/model-connections/[connectionId]` | SYSTEM_ADMIN |
| POST | `/api/admin/model-connections/[connectionId]/test` | SYSTEM_ADMIN |
| GET/PUT | `/api/admin/ai-model-bindings` | SYSTEM_ADMIN |
| GET | `/api/admin/ai-task-rules` | SYSTEM_ADMIN |
| GET | `/api/admin/ai-task-rules/[capabilityId]` | SYSTEM_ADMIN |
| PUT | `/api/admin/ai-task-rules/[capabilityId]/draft` | SYSTEM_ADMIN |
| POST | `/api/admin/ai-task-rules/[capabilityId]/check` | SYSTEM_ADMIN |
| POST | `/api/admin/ai-task-rules/[capabilityId]/publish` | SYSTEM_ADMIN |
| POST | `/api/admin/ai-task-rules/[capabilityId]/rollback` | SYSTEM_ADMIN |
| POST | `/api/admin/ai-task-rules/[capabilityId]/use-builtin` | SYSTEM_ADMIN |
| POST | `/api/admin/ai-task-rules/[capabilityId]/import-markdown` | SYSTEM_ADMIN |
| POST | `/api/admin/ai-task-rules/[capabilityId]/test-run` | SYSTEM_ADMIN |
| GET | `/api/admin/ai-task-rules/[capabilityId]/versions` | SYSTEM_ADMIN |

### 17.3 项目与工作台

| Method | Path | 权限 |
|--------|------|------|
| GET/POST | `/api/projects` | mgmt / admin create |
| GET/PATCH | `/api/projects/[projectId]` | mgmt project |
| GET/POST/PUT/DELETE | `/api/projects/[projectId]/members` | owner/admin |
| GET | `/api/workspace/projects` | session |
| GET | `/api/workspace/projects/[projectId]` | workspace project |
| GET | `/api/workspace/projects/[projectId]/video-access` | video canvas |

### 17.4 故事/剧本/资产

| Method | Path | 权限 |
|--------|------|------|
| GET/PUT | `/api/projects/[projectId]/story-draft` | mgmt project |
| GET/PUT | `/api/projects/[projectId]/script-draft` | mgmt project |
| POST | `/api/projects/[projectId]/script-draft/import-txt` | mgmt project |
| POST | `/api/projects/[projectId]/script-draft/import-docx` | mgmt project |
| POST | `/api/projects/[projectId]/script-draft/import-markdown` | mgmt project |
| GET/PUT | `/api/projects/[projectId]/assets-draft` | workspace asset |
| PUT/GET/DELETE | `/api/projects/[projectId]/assets-draft/images/[assetId]` | workspace asset |
| PUT/GET/DELETE | `/api/projects/[projectId]/assets-draft/audio/[assetId]` | workspace asset |
| GET | `/api/projects/[projectId]/asset-designs` | mgmt project |
| GET/PUT | `/api/projects/[projectId]/asset-designs/episodes/[episodeId]` | mgmt project |
| POST | `/api/projects/[projectId]/asset-designs/episodes/[episodeId]/apply-generation` | mgmt project |
| POST | `/api/projects/[projectId]/asset-designs/episodes/[episodeId]/confirm` | mgmt project |
| POST | `/api/projects/[projectId]/text-generations` | session+role |
| POST | `/api/projects/[projectId]/text-generations/[generationId]/cancel` | session+role |
| GET/PUT | `/api/projects/[projectId]/workbench` | mgmt project |

### 17.5 分镜工作区

| Method | Path | 权限 |
|--------|------|------|
| GET/PUT | `/api/projects/[projectId]/storyboard-workspace` | storyboard |
| GET/PATCH | `/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]` | storyboard |
| PATCH | `.../episodes/[episodeId]/confirm-script` | storyboard |
| GET/POST | `.../episodes/[episodeId]/storyboard` | storyboard |
| POST | `.../storyboard/generate` | storyboard |
| POST | `.../storyboard/confirm` | storyboard |
| PATCH | `.../storyboard/shots/[shotId]` | storyboard |
| POST | `.../shots/[shotId]/regenerate-prompt` | storyboard |
| POST | `.../shots/[shotId]/generate-video` | video canvas |
| GET | `.../shots/[shotId]/video-history` | storyboard |
| POST | `.../storyboard/generate-videos` | video canvas |
| POST | `.../asset-matches/auto` | **deprecated** |
| POST | `.../asset-matches/confirm` | **deprecated** |
| PATCH | `.../asset-matches/[matchId]` | **deprecated** |

### 17.6 视频生成与工作流

| Method | Path | 权限 |
|--------|------|------|
| GET/POST | `/api/generations` | video canvas |
| GET | `/api/generations/[generationId]` | video-for-generation |
| POST | `/api/generations/[generationId]/cancel` | video |
| POST | `/api/generations/[generationId]/retry` | video |
| POST | `/api/generations/[generationId]/reconcile` | video |
| GET/PATCH | `/api/generations/[generationId]/metadata` | video |
| POST | `/api/generations/[generationId]/transfer` | video |
| GET/PUT | `/api/workflow` | video canvas |
| POST | `/api/generate/character-image` | video canvas |
| POST | `/api/generate/scene-image` | video canvas |
| POST | `/api/generate/character-voice` | video canvas |
| POST | `/api/generate/video-shot` | video canvas |
| GET | `/api/generated-videos/[fileName]` | path-safe read |
| GET | `/api/mock-video/status` | public |
| GET/POST | `/api/assets` | 弱/无登录 |
| GET/PATCH/DELETE | `/api/assets/[assetId]` | 弱/无登录 |

### 17.7 本地付费测试（DEV only）

| Method | Path |
|--------|------|
| GET/POST | `/api/local-paid-test` |
| POST | `/api/local-paid-test/arm` |
| POST | `/api/local-paid-test/submit` |
| POST | `/api/local-paid-test/dry-run` |
| GET | `/api/local-paid-test/simulation` |

**合计：67 个 `route.ts` 文件**（与代码审计一致）。

---

## 第 18 章 — 核心类型索引

| 类型 | 路径 |
|------|------|
| `AuthUser` / `StoredUser` | `src/auth/types.ts` |
| `EffectiveProjectRole` / `ProjectMember` | `src/auth/roles.ts` |
| `ProjectRecord` / `CreateProjectInput` | `src/projects/types.ts` |
| `ScriptEpisode` / `ScriptDraft` | `src/projects/script/types.ts` |
| `CharacterAsset` / `SceneAsset` / `PropAsset` / `AudioAsset` | `src/projects/assets/types.ts` |
| `EpisodeAssetDesignRecord` / `AssetDesignResolution` | `src/projects/assets/episode-design/types.ts` |
| `EpisodeProduction` / `StoryboardShot` | `src/projects/storyboard/types.ts` |
| `ShotRequirementResolution` | 同上（UNRESOLVED/LINKED/NOT_REQUIRED） |
| `GenerationRecord` / `GenerationJobStatus` | `src/video-generation/types.ts` |
| `AiCapabilityDefinition` | `src/ai-config/capabilities.ts` |

---

## 第 19 章 — 文件持久化映射

| 域 | 路径（相对 `APP_DATA_DIR` 或 `data/`） |
|----|----------------------------------------|
| users | `users.json` |
| members | `project-members.json` |
| credits | `credits.json` |
| projects | `projects/{id}.json` |
| story draft | `projects/{id}/drafts/story.json` |
| script draft | `projects/{id}/drafts/script.json` |
| assets bundle | `projects/{id}/drafts/assets.json` |
| episode asset designs | `projects/{id}/drafts/episode-asset-designs.json` |
| storyboard | `projects/{id}/drafts/storyboard-production.json` |
| asset images | `projects/{id}/drafts/asset-images/{assetId}` |
| asset audio | `projects/{id}/drafts/asset-audio/{assetId}` |
| workflows | `workflows/{projectId}.json` |
| generations | `generations/{id}.json` |
| AI configs | `generation-api-configs.json` |
| AI model connections | `ai-model-connections.json` |
| AI task rules | `ai-task-rules.json` |
| mock MP4 | `mock/mock-video.mp4` |
| generated videos | `generated-videos/` |
| object storage | `object-storage/`（`FILE_STORAGE_DRIVER=local`） |
| project create idempotency | `project-create-idempotency/` |
| canvas assets | `assets/`（工作流，与管理 draft 分离） |

`APP_DATA_DIR` 默认 `cwd/data`；测试通过 `vitest.setup.ts` 指向临时目录。

---

## 第 20 章 — PostgreSQL

- Schema：`prisma/schema.prisma`；migration `20260726120000_init_persistence`
- Repos：User/Project/Document/ScriptEpisode/File/Asset/Workflow/Credit 等
- **页面真实切 PG：仅项目 list/create/get/patch**（`PERSISTENCE_DRIVER=postgres`）
- 其余域仍文件 JSON
- 集成测试：`npm run test:postgres`（需 `TEST_DATABASE_URL` → `infinite_canvas_test`）
- Docker Compose：`docker compose up -d postgres postgres-test`（`db:up` script）
- **状态：schema 存在；PERSISTENCE_DRIVER=file 默认；full PG 流程 **未验证**；legacy apply **禁止**执行**
- `TEST_DATABASE_URL`：当前 shell unset；Docker Engine 未完全验证

---

## 第 21 章 — 状态机

### 21.1 剧集生产 `EpisodeProductionStatus`

| 状态 | 说明 |
|------|------|
| `awaiting_script` | 待确认剧本 |
| `awaiting_storyboard` | 剧本已确认，可生成分镜 |
| `storyboard_generating` | 生成中 |
| `storyboard_incomplete` | 有未完成镜头 |
| `storyboard_review` | 可确认 |
| `storyboard_done` | 已确认，可生成视频 |
| `generation_failed` | 生成失败 |
| `awaiting_asset_match` / `assets_pending_confirm` | 旧数据；归一化展示 |

### 21.2 按集资产设计 `EpisodeAssetDesignStatus`

`not_started` → `generating` → `review` → `confirmed`；`stale` / `failed`。

### 21.3 镜头需求 `ShotRequirementResolution`

`UNRESOLVED` → `LINKED`（选资产）或 `NOT_REQUIRED`（无需独立资产）。

### 21.4 视频 Job `GenerationJobStatus`

`validating` → `submitting` → `queued` → `processing` → `downloading` → terminal states。

UI 另有 `stale`（内容过期，非 job status）。

---

## 第 22 章 — 按钮地图（摘要表）

完整表见 `docs/CURRENT_CODE_AND_BUTTON_MAP.md` §2。关键按钮：

| 页面 | 文案 | Handler | API |
|------|------|---------|-----|
| 首页 | 登录 | submit | POST /api/auth/login |
| 项目管理 | 新建项目 | create | POST /api/projects |
| 资产设计 | 提取/重新提取 | stream | POST text-generations → apply-generation |
| 资产设计 | 取消生成 | abort+cancel | POST text-generations cancel |
| 资产设计 | 保存本集资产 | save | PUT asset-designs/episodes/[id] |
| 资产设计 | 确认本集资产 | confirm | POST confirm |
| 资产设计 | 查看本集剧本 | modal | 无（只读） |
| 资产设计 | 手动添加 | dialog | 本地 draft only |
| 资产库 | 上传/清除图片音频 | upload/clear | PUT/DELETE images/audio |
| 故事 | 生成 | stream | POST text-generations (story) |
| 故事 | 生成大纲 | stream | POST text-generations (script_outline) |
| 故事 | 根据大纲生成剧集 | blocked | AI_CAPABILITY_PLANNED |
| 故事 | 继续生成 | disabled | planned Stub |
| 剧本 | 上传 TXT/DOCX/MD | import | import-* routes |
| 分镜 | 确认剧本 | confirm | confirm-script |
| 分镜 | 生成本集分镜 | generate | storyboard/generate |
| 分镜 | 确认本集分镜 | confirm | storyboard/confirm |
| 镜头 | 生成本镜头视频 | precheck→generate | generate-video |
| 分镜 | 一键生成本集视频 | batch | generate-videos |
| 管理 | API/AI 模型配置 | save/test | admin/api-configs |

---

## 第 23 章 — 调用链（关键路径）

### 23.1 登录

`HeaderLoginPanel` → `POST /api/auth/login` → `users.json` → session cookie → `/app`

### 23.2 按集资产设计

`EpisodeAssetDesignWorkspace` → `POST text-generations`（SSE）→ `apply-generation` → `PUT` save → `POST confirm` → `atomicWriteTwoJsonFiles` → `assets.json`

### 23.3 剧本导入

`ScriptUploadPanel` → `import-txt/docx/markdown`（预览）→ `ScriptTxtImportPreview` → `PUT script-draft`

### 23.4 分镜视频

`ShotVideoGenerationButton` → `getShotVideoBlocker` → `POST generate-video` → `submitVideoGeneration` → `generation-store`

### 23.5 文本积分

`run-generation.ts` → `reserveCredits` → provider → `settleCredits` / `releaseCredits` → `credits.json`

详见 `docs/CURRENT_CODE_AND_BUTTON_MAP.md` §1。

---

## 第 24 章 — 关键函数索引

| 主题 | 函数 | 路径 |
|------|------|------|
| 有效权限 | `resolveEffectiveProjectRole` | `auth/effective-role.ts` |
| 工作台过滤 | `listAccessibleWorkspaceProjectIds` | 同上 |
| 镜头完整度 | `getShotCompletenessStatus` / `isShotConfirmReady` | `shot-completeness.ts` |
| 确认失效 | `invalidateAfterScriptChange` | storyboard invalidate |
| 视频记录 | `resolveLatestShotVideoGeneration` | `resolve-shot-video.ts` |
| 视频预检 | `getShotVideoBlocker` / `listShotVideoBlockers` | `shot-video-precheck.ts` |
| 批次并发 | `mapWithConcurrency` | `storyboard-video-generate.ts` |
| 历史 ID | `appendShotVideoHistory` | `video-history-ids.ts` |
| 资产设计确认 | `confirmEpisodeAssetDesign` / `atomicWriteTwoJsonFiles` | `episode-design/confirm.ts` |
| 内容指纹 | `getScriptEpisodeContentFingerprint` | `episode-design/fingerprint.ts` |
| AI 解析 | `resolveAiCapabilityRuntimeConfig` | `ai-config/resolve.ts` |
| 执行计划 | `resolveAiExecutionPlan` | `ai-config/execution-plan.ts` |
| Prompt 组装 | `assembleTextSystemPrompt` / `assembleUntrustedUserData` | `ai-config/prompt-assembly.ts` |
| 任务规则 | `getEffectivePublishedRule` / `publishRule` / `rollbackRule` | `ai-config/task-rules-store.ts` |
| 模型接入 | `resolveConnectionForSlot` | `ai-config/model-connections.ts` |
| Secret 加密 | encrypt/decrypt helpers | `ai-config/secret-crypto.ts` |
| 数据根 | `resolveAppDataPath` | `persistence/data-root.ts` |
| 哈希 | `hashAppDataDir` | `scripts/hash-app-data.ts` |

---

## 第 25 章 — 测试地图

| 功能域 | 测试文件（示例） | 类型 |
|--------|-----------------|------|
| 权限/认证 | `src/auth/__tests__/*` | 单元 |
| 工作台路由 | `workspace-permission-routes.test.ts`, `route-wiring.test.ts` | 单元 |
| 资产双模块 | `asset-module-routes.test.ts`, `episode-asset-design-ui.test.ts` | 单元 |
| 按集资产设计 | `episode-design/__tests__/*`, `episode-asset-design-generate-route.test.ts` | 单元/路由 |
| 资产图片/音频 | `asset-image-routes.test.ts`, `asset-audio-routes.test.ts` | 单元 |
| 剧本 TXT/DOCX/MD | `script-txt-*.test.ts`, `script-docx-*.test.ts`, `script-markdown-*.test.ts` | 单元 |
| 故事/大纲生成 | `story-text-generations-route.test.ts`, `script-outline-route.test.ts` | 路由 |
| 分镜流程 | `creation-flow.test.ts`, `storyboard-layout-video.test.ts` | 单元 |
| 视频生成 | `src/video-generation/__tests__/*` | 单元 |
| AI 配置 / H2 | `src/ai-config/__tests__/*`（含 execution-plan、task-rules、model-connections、runtime-single-call） | 单元 |
| 持久化 | `src/persistence/__tests__/*` | 单元 |
| PostgreSQL | `postgres-project-store.test.ts` 等 | **仅 test:postgres** |
| Smoke 隔离 | `smoke-app-data-guard.test.ts`, `data-root-isolation.test.ts` | 单元 |
| 浏览器 Smoke | `scripts/smoke-*-browser-seed.ts` + Cursor browser | **手工/脚本；非 vitest 门禁** |

**Vitest 文件数：约 100 个 `*.test.ts` 源文件；H2 门禁实测 **100 files / 755 tests passed**（见第 26 章）。

---

## 第 26 章 — 运行门禁

门禁实测时间：2026-07-29 Asia/Shanghai（H2-AI-CONTROL）。命令：`npm test -- --maxWorkers=1`（项目已验证）。

| 命令 | 退出码 | 结果 |
|------|--------|------|
| `npm run lint` | 0 | 通过 |
| `npx eslint . --max-warnings=0` | 0 | 通过（0 warnings） |
| `npm run typecheck` | 0 | 通过 |
| `npm test -- --maxWorkers=1` | 0 | **100** files / **755** tests passed；0 failed；0 skipped |
| `npm run build` | 0 | 通过（`prisma generate` + `next build --webpack`） |
| `git diff --check` | 0 | 通过 |
| `npx tsx scripts/hash-app-data.ts` | 0 | VERIFY 观测 **847** / `2b51d433…`（时间点；**非**永久基线）；历史追溯 **844** / `5d645e99…` |
| H2 浏览器 Smoke | — | :3043；**29/29**；隔离 `APP_DATA_DIR`；`C:\Temp\h2-browser-report.json`；未污染真实 `data/` |
| `npm run test:postgres` | — | **未运行**（`TEST_DATABASE_URL` unset；Engine 未完全验证） |

本次审计任务仅修改 `docs/*`；未改业务代码、未新增依赖。`package.json` / `package-lock.json` 相对 HEAD 仍为工作区既有 dirty（非本任务引入）。

测试隔离：`vitest.setup.ts` 每 worker `mkdtemp` → `APP_DATA_DIR`；注入 `AI_CONFIG_ENCRYPTION_KEY`。

---

## 第 27 章 — 浏览器 Smoke 摘要（诚实）

| Smoke 批次 | 日期 | 端口 | 范围 | 结果 |
|-----------|------|------|------|------|
| **H2-AI-CONTROL 浏览器** | 2026-07-29 | :3043 | Admin 双 Tab、modelConnection、任务规则 draft/publish/rollback、script.split 元数据 | ✅ **29/29** |
| Assets UI Parity | 2026-07-28 | :3040（isolated APP_DATA_DIR） | Owner dual-nav + redirect design + 手动添加 dialog + library | ✅ DONE（该 scope） |
| 分镜视频/layout（Batch B 历史） | 2026-07-28 前 | :3020 等 | 翻页、Range、无场景弹窗 | ✅（历史记录；目录可能已清理） |
| 资产音频 D2 | 历史 | :3016 | file input → 播放 → Range | ✅（历史记录） |
| **G1-R 完整浏览器** | — | — | extract/edit/save/confirm/stale/empty/cancel/illegal JSON recover | **未完成完整浏览器 UI 验收** |
| API/route smoke | 有 | — | SSE → apply → confirm 路径 | ✅ 单元/路由测试；**≠ browser smoke** |

遗留目录：`C:\Temp\ic-smoke-da8f5426a83c20dc-beZnqP`（较旧；未验证是否仍可用）。

Port 3000：文档生成时 **未监听**。

---

## 第 28 章 — 完成度矩阵

| 模块 | 状态 |
|------|------|
| 首页 / 登录 | ✅ |
| 工作台 / 项目管理 / 权限 / 成员 | ✅ |
| 故事生成 + 大纲 | ✅ text-generations |
| 剧本 TXT/DOCX/MD 导入 | ✅ |
| 剧本 PDF | 🔴 **产品不支持** |
| 根据大纲生成剧集 / 续写 | 🔴 planned（E2 暂停） |
| 剧本/故事导出 Word | 🔴 NON_AI Stub |
| AI 配置中心 + Secret 加密 + H2 模型/规则 | ✅ |
| 资产双模块 + 按集设计（G1） | ✅ |
| G1-UI 布局/按钮契约 | ✅ 代码 verified |
| G1-R 完整浏览器 smoke | 🟡 **未完成** |
| 资产元数据 + 图片/音频二进制 | ✅ |
| 分镜两步流程 + 视频 Mock | ✅ |
| 独立资产匹配页 | 🗑️ UI 已删 |
| React Flow 画布 | ✅ Mock 路径 |
| 文本积分 | 🟡 文件账本 |
| 视频积分 vs registry | 🟡 不一致（registry yes；credits.json no） |
| PostgreSQL | ⚠️ 仅项目 CRUD 可选；**未验证** |
| 团队/企业库/展示/指引 | 🔴 ModulePlaceholder Stub |

---

## 第 29 章 — 风险

### 仍存在

1. **未提交工作区（120 行）** — 误操作 reset/clean 会丢成果
2. **`data/` 运行时数据** — 勿删、勿被测试污染
3. **真实付费 Provider** — 默认关闭；误开会扣费
4. **文件/PG 双源** — 仅项目可切 PG，其它仍文件
5. **生成幂等 / 积分** — 依赖正确 idempotencyKey
6. **跨项目资产** — 服务端有校验；前端需守边界
7. **直接 URL 越权** — 依赖 layout/API gate
8. **PostgreSQL 未验证** — Docker Engine / TEST_DATABASE_URL 常不可用
9. **G1-R 浏览器未闭环** — 仅 API/unit 证据
10. **视频 credits 声明 vs 实现不一致**

### 已关闭（相对旧报告）

- 分镜占位页、无视频、无权限、工作台=画布、独立资产匹配必经、资产未落盘、TXT/DOCX/MD Stub、故事 Stub、PDF 待开发、无 AI 配置、无按集设计、查看资产库冗余按钮等 — **均已否**

---

## 第 30 章 — 未完成项（优先级排序）

| 优先级 | 项 | 说明 |
|--------|-----|------|
| P0 | G1-R 浏览器 smoke 闭环 | extract/save/confirm/stale/cancel/非法 JSON 恢复 |
| P1 | PostgreSQL 集成验证 | Docker Engine + test:postgres |
| P2 | E2 恢复 | `script.episodes.generate` |
| P3 | 剧集续写 | `script.continue.generate` |
| P4 | 剧本/故事导出 | NON_AI Stub → 真实 Word |
| P5 | 团队/企业库/展示/指引 | ModulePlaceholder → 真实功能 |
| P6 | 视频 credits 与 registry 对齐 | 实现或修正 registry |
| — | PDF | **不属于待开发** |

---

## 第 31 章 — 下一批次建议（3–5 批）

### Batch 1（推荐立即）：G1-R 残余浏览器 UI Smoke

- 范围：extract → edit → save → confirm → stale → empty → cancel → illegal JSON recover
- 环境：isolated `APP_DATA_DIR`；非 3000 端口；`.ic-smoke-run` 标记
- 验收：浏览器实测 + 截图/步骤记录；**不**把 API smoke 冒充 browser smoke

### Batch 2：E2 恢复（若产品恢复）

- `script.episodes.generate` active 化
- `outputKind=script_episodes` 端到端
- 大纲 → 剧集预览 → 确认写 `script-draft.episodes`

### Batch 3：PostgreSQL 验证

- `docker compose up` + `npm run test:postgres`
- 文档化 PG 切换步骤与限制

### Batch 4：导出 / Stub 模块

- `exportScriptToWord` / `exportDocuments` 或团队/企业库择一

**G1-UI 已完成** → 不应再重复 G1-UI 工作；优先 G1-R 浏览器 closure。门禁已回填（第 26 章）。

---

## 第 32 章 — 安全清单

- [ ] 不执行 `git reset` / `clean` / `restore .`
- [ ] 不删除 `data/`
- [ ] 不执行 `npm run db:legacy:import --apply`
- [ ] 测试使用隔离 `APP_DATA_DIR`
- [ ] 不修改 `.env` 中 `VIDEO_PROVIDER` / `ALLOW_PAID_GENERATION` 默认
- [ ] 不写入文档：密码、API Key、用户脚本全文、passwordHash
- [ ] 不擅自切换 `PERSISTENCE_DRIVER=postgres` 于生产
- [ ] Mock 不冒充付费能力；planned 不伪装 active
- [ ] `data/` 哈希只用 `npx tsx scripts/hash-app-data.ts`
- [ ] CE 不可访问 design（含直接 URL）
- [ ] 后台 AI 配置不能绕过 `ALLOW_PAID_GENERATION=false`
- [ ] 不把 API/route 测试结论写成 browser UI 验收

---

## 第 33 章 — 新对话开场文本

> 完整可复制文本亦见 `docs/NEW_CHAT_BOOTSTRAP.md`；**本文件为唯一完整基线**，下文引用 `CURRENT_PROJECT_MASTER_HANDOFF.md`。

### A. ChatGPT 规划助手

```text
你是本产品的规划与批次指令助手。先阅读仓库中的当前基线文档（不要阅读旧交接报告当真相）：

1. docs/CURRENT_PROJECT_MASTER_HANDOFF.md  （唯一完整基线）
2. docs/CURRENT_CODE_AND_BUTTON_MAP.md
3. docs/AI_BUTTON_API_CONFIG_AUDIT.md

读完后，先用极短篇幅复述：
- 当前已完成（真实持久化 / API / 单测 / 浏览器 Smoke）；
- 当前未完成；
- 当前安全限制；
- 当前真实未完成项（G1-R 浏览器 smoke；根据大纲生成剧集 paused/planned；剧集续写；剧本导出；PostgreSQL 未验证；团队/企业库/展示/指引 Stub）。

以下决定已经确认，不要重新询问：
- 历史数据迁移已取消；PostgreSQL 未来干净起步；
- 不执行 legacy apply；
- 工作台与项目管理已分离；权限矩阵已确认；
- 分镜采用两步流程；独立资产匹配页已删除；
- CARD_ENGINEER 只能操作工作台资产库（不可 design/story/script/storyboard/video）；
- 资产双模块 + 按集资产设计（G1）+ G1-UI 已完成；
- G1-R 完整浏览器 smoke 未完成；
- script.episodes.generate 为 planned / E2 暂停；
- API Key AES-256-GCM 加密；后台不能绕过 ALLOW_PAID_GENERATION；
- data/：历史快照 **844** / `5d645e99…`；VERIFY 观测 **847** / `2b51d433…`（均非永久固定/干净基线；在用业务库；`:3000` 合法操作可改哈希）；事件 OPEN/NON-BLOCKING；不影响 H2 COMPLETE；
- H2-AI-CONTROL **功能验收 COMPLETE + 批次总状态 COMPLETE**（模型接入、任务规则、单次 Provider 调用、Admin 双 Tab）；
- 核心自动化验收：`APP_DATA_DIR` 隔离证明（非钉死全目录哈希）；
- PDF 产品明确不支持；
- 默认 VIDEO_PROVIDER=mock、ALLOW_PAID_GENERATION=false、TEXT_LLM_PROVIDER=mock。

工作区 dirty（120 行）：禁止 reset/clean/restore/删 data/自动 commit/push。
新任务只输出可直接复制给 Cursor 的「本批次指令」。
```

### B. Cursor 实现助手

```text
先阅读：
- docs/CURRENT_PROJECT_MASTER_HANDOFF.md  （唯一完整基线）
- docs/CURRENT_CODE_AND_BUTTON_MAP.md
- docs/AI_BUTTON_API_CONFIG_AUDIT.md

硬性约束：
1. 以当前工作区代码为准，不回退 HEAD（a8149a0）；
2. 禁止 git reset / clean / checkout -- . / restore .；
3. 禁止自动 commit / push；
4. 禁止修改真实 data/；Vitest/API/Browser Smoke 必须隔离 APP_DATA_DIR；不杀用户 :3000；
5. 不执行 legacy apply；不改 VIDEO_PROVIDER / ALLOW_PAID_GENERATION 默认；
6. 不用 Mock 冒充正式付费能力；planned 不得伪装 active；
7. 全目录哈希仅为时间点观测（`hash-app-data.ts`）；日常不以钉死哈希为 COMPLETE 硬门禁；测试数据入真实 data/ 则停批；
8. G1-UI 已完成；优先 G1-R 浏览器 smoke closure，勿重复 G1-UI；
9. 不要实现 PDF；script.episodes.generate 为 planned；
10. 不把 API smoke 写成 browser smoke。

分支：feat/react-flow-migration；dirty YES（120 lines）。
已阅读后，先只输出你理解的当前代码基线和本次任务涉及的文件，等待下一条具体任务。
```

---

## 附录 A — `git status --short` 完整列表（120 行）

来源：`C:\Temp\ic-handoff-git-status.txt`（生成时快照；不含 secret 文件内容）。

```
 M .env.example
 M .gitignore
 M README.md
 M package-lock.json
 M package.json
 M src/app/api/admin/api-configs/route.ts
 M src/app/api/auth/login/route.ts
 M src/app/api/auth/me/route.ts
 M src/app/api/generated-videos/[fileName]/route.ts
 M src/app/api/generations/[generationId]/cancel/route.ts
 M src/app/api/generations/[generationId]/metadata/route.ts
 M src/app/api/generations/[generationId]/reconcile/route.ts
 M src/app/api/generations/[generationId]/retry/route.ts
 M src/app/api/generations/[generationId]/route.ts
 M src/app/api/generations/[generationId]/transfer/route.ts
 M src/app/api/generations/route.ts
 M src/app/api/workflow/route.ts
 M src/app/layout.tsx
 D src/app/login/page.tsx
 M src/app/page.tsx
 M src/app/workflow/page.tsx
 M src/auth/ApiManagePanel.tsx
 M src/auth/AuthUserMenu.tsx
 M src/auth/api-config.ts
 M src/auth/types.ts
 M src/auth/users.ts
 M src/middleware.ts
 M src/video-generation/__tests__/idempotency-persistence.test.ts
 M src/video-generation/__tests__/mock-e2e-service.test.ts
 M src/video-generation/__tests__/mock-video-source.test.ts
 M src/video-generation/__tests__/reference-media-selection.test.ts
 M src/video-generation/__tests__/secure-transfer.test.ts
 M src/video-generation/__tests__/stage-3a-playback.test.ts
 M src/video-generation/__tests__/wan27-provider.test.ts
 M src/video-generation/asset-resolver.ts
 M src/video-generation/compare-params.ts
 M src/video-generation/dimensions.ts
 M src/video-generation/generation-store.ts
 M src/video-generation/idempotency/file-store.ts
 M src/video-generation/local-paid-test/guard-store.ts
 M src/video-generation/model-capabilities.ts
 M src/video-generation/provider/config.ts
 M src/video-generation/provider/index.ts
 M src/video-generation/provider/mock-provider.ts
 M src/video-generation/provider/wan27-dry-run.ts
 M src/video-generation/reference-media/collect-candidates.ts
 M src/video-generation/secure-transfer/build-transfer-source.ts
 M src/video-generation/secure-transfer/types.ts
 M src/video-generation/serve-generated-video.ts
 M src/video-generation/service.ts
 M src/video-generation/transfer-video.ts
 M src/video-generation/types.ts
 M src/video-generation/validate-mock-video-source.ts
 M src/workflow/components/CharacterPromptPanel.tsx
 M src/workflow/components/GenerationConfirmationDrawer.tsx
 M src/workflow/components/MentionTextarea.tsx
 M src/workflow/components/PaneContextMenu.tsx
 M src/workflow/components/VideoPromptPanel.tsx
 M src/workflow/components/WorkflowEditor.tsx
 M src/workflow/components/WorkflowToolbar.tsx
 M src/workflow/components/nodes/ImageNode.tsx
 M src/workflow/hooks/useWorkflowAutosave.ts
 M src/workflow/lib/asset-storage.ts
 M src/workflow/lib/build-video-generation-input.ts
 M src/workflow/lib/character-generation.ts
 M src/workflow/lib/scene-generation.ts
 M src/workflow/lib/video-shot-generation.ts
 M src/workflow/lib/workflow-storage.ts
 M src/workflow/store.ts
 M tsconfig.json
 M vitest.config.ts
?? data/object-storage/
?? data/project-create-idempotency/
?? data/project-members.json
?? data/projects/
?? docker-compose.yml
?? docs/AI_BUTTON_API_CONFIG_AUDIT.md
?? docs/CURRENT_CODE_AND_BUTTON_MAP.md
?? docs/CURRENT_PROJECT_HANDOFF.md
?? docs/NEW_CHAT_BOOTSTRAP.md
?? docs/persistence-baseline.md
?? docs/persistence.md
?? prisma/
?? scripts/
?? src/ai-config/
?? src/app/api/admin/api-configs/test/
?? src/app/api/ai-capabilities/
?? src/app/api/auth/navigation/
?? src/app/api/auth/password/
?? src/app/api/credits/
?? src/app/api/mock-video/
?? src/app/api/projects/
?? src/app/api/text-models/
?? src/app/api/workspace/
?? src/app/app/
?? src/app/workflow/WorkflowCanvasClient.tsx
?? src/auth/__tests__/
?? src/auth/capabilities.ts
?? src/auth/effective-role.ts
?? src/auth/page-guards.ts
?? src/auth/project-members.ts
?? src/auth/require-access.ts
?? src/auth/roles.ts
?? src/home/
?? src/persistence/
?? src/projects/
?? src/shell/
?? src/text-generation/
?? src/video-generation/__tests__/admin-http-video-provider.test.ts
?? src/video-generation/__tests__/http-video-dialect.test.ts
?? src/video-generation/__tests__/poll-provider-mismatch.test.ts
?? src/video-generation/provider/http-video-dialect.ts
?? src/video-generation/provider/http-video-provider.ts
?? src/workflow/__tests__/document-history.test.ts
?? src/workflow/components/FrameSlotButton.tsx
?? src/workflow/components/MockSetupBanner.tsx
?? src/workflow/components/StoryboardPanel.tsx
?? src/workflow/lib/document-history.ts
?? vitest.postgres.config.ts
?? vitest.setup.ts
```

---

## 附录 B — 相关文档索引

| 文档 | 用途 |
|------|------|
| `docs/CURRENT_PROJECT_MASTER_HANDOFF.md` | **本文件 — 唯一完整基线** |
| `docs/CURRENT_CODE_AND_BUTTON_MAP.md` | 按钮地图与调用链细节 |
| `docs/AI_BUTTON_API_CONFIG_AUDIT.md` | AI capability 与付费门禁审计 |
| `docs/NEW_CHAT_BOOTSTRAP.md` | 新对话开场文本（精简版） |
| `docs/AI_TASK_RULES_ARCHITECTURE.md` | H2 任务规则与执行计划架构 |
| `docs/persistence.md` / `persistence-baseline.md` | 持久化设计笔记 |

---

*文档结束。H2-AI-CONTROL 门禁与 Smoke 见第 26 章。*
