# CURRENT_CODE_AND_BUTTON_MAP — 底层代码与按钮地图

> 本文件是 **快速定位地图**（调用链、按钮、API、类型、测试），不是完整基线。  
> **完整事实基线：** `docs/CURRENT_PROJECT_MASTER_HANDOFF.md`  
> 配合：`docs/CURRENT_PROJECT_HANDOFF.md`（概览）、`docs/AI_BUTTON_API_CONFIG_AUDIT.md`（AI capability）  
> 分支：`feat/react-flow-migration` · 生成时间：**2026-07-29**（H2-AI-CONTROL）

---

## 1. 页面到数据的调用链

### 登录

`HeaderLoginPanel` → `POST /api/auth/login` → `users.json` → session `ic_session` → `/app`

### 工作台项目列表

`workspace/page.tsx` → `GET /api/workspace/projects` → `listAccessibleWorkspaceProjectIds`

### 项目创建 / 成员

`CreateProjectWizardDialog` → `POST /api/projects`（SYSTEM_ADMIN only）  
`ProjectMembersPanel` → `/api/projects/[id]/members` → `project-members.json`

### 资产保存（资产库）

`AssetManagementWorkspace`（management **或** workspace library 模块）  
→ `GET/PUT /api/projects/[id]/assets-draft` → `requireWorkspaceAssetAccess` → `drafts/assets.json`

**路由：**
- 管理：`/app/projects/[id]/assets/library`；入口 `/assets` → redirect **design**
- 工作台：`/app/workspace/projects/[id]/assets/library`；入口 `/assets` → design（Owner/Admin）或 library（CE）
- **Owner/Admin 工作台双模块：** design + library nav；**CE 仅 library**

### 按集资产设计（G1 · active）

`EpisodeAssetDesignWorkspace`（`/assets/design`；`ProjectAssetsShell` + `AssetModuleNav`）  
→ `GET .../asset-designs` / `GET .../asset-designs/episodes/[episodeId]`  
→ 「提取本集资产」/「重新提取」→ `streamStoryGeneration({ outputKind: "episode_asset_design", episodeId })`  
→ `POST .../text-generations`（SSE）→ `asset.episode-design.generate`  
→ `POST .../apply-generation` → 编辑 → 「保存本集资产」`PUT` → 「确认本集资产」`POST .../confirm`（原子双文件 → `assets.json`）  
→ 「取消生成」→ abort + `POST .../text-generations/[id]/cancel`  
→ 「查看本集剧本」→ 只读弹窗（`data-testid="ead-view-script"`；无 API）  
→ 「手动添加」→ `*CreateDialog` → 设计草稿 `create_new`（确认前不入库）  
→ 进入资产库：**仅** `AssetModuleNav`「资产库」（**无**设计区内「查看资产库」冗余按钮）  
→ 布局：左 `clamp(230px, 21vw, 280px)` + 右侧 `amw-panel` 详情  
→ 权限：管理端设计 API `requireActualProjectOwner`（经 `requireProjectManagementProjectAccess`）；CE **拒绝管理端**；工作台 design **允许 CE**（`assertWorkspaceAssetDesignPage`）
→ 数据：管理正式 drafts；工作台 snapshot + workspaceLocal（单向同步）

### 资产图片 / 音频

- 图片：`PUT/GET/DELETE .../assets-draft/images/[assetId]` → `drafts/asset-images/{assetId}`（10 MiB；PNG/JPEG/WebP）
- 音频：`PUT/GET/DELETE .../assets-draft/audio/[assetId]` → `drafts/asset-audio/{assetId}`（50 MiB；Range）
- 画布素材：`POST /api/assets` → `APP_DATA_DIR/assets/`（与管理 draft 分离）

### 剧本导入（TXT / DOCX / MD；PDF 不支持）

`ScriptUploadPanel`（**不含** `.pdf`）→ `import-txt` / `import-docx` / `import-markdown`（预览）→ `PUT script-draft`

### 故事 / 大纲生成

`StoryInputPanel`「生成」→ `POST .../text-generations`（`story.generate`）→ 预览 → `PUT story-draft`  
「讨论大纲」→ `script.outline.generate` → 预览 → `PUT script-draft.outlineText` only  
剧集 / 续写：**planned** Stub

### 分镜 / 视频

`ScriptConfirmationPanel` → confirm-script → `StoryboardProductionPanel` generate/confirm  
`ShotVideoGenerationButton` / `EpisodeVideoGenerationButton` → precheck → generate-video / generate-videos  
播放：`ShotVideoPreview` + `GET .../video-history` + Range assets URL

### 积分

文本：`run-generation.ts` → `credits.json` reserve/settle/release  
视频：registry `requiresCredits: true`，但 **video-generation 不写 credits.json**（idempotency reserve only）

### AI 配置（H2）

`ApiManagePanel`（SYSTEM_ADMIN，账户菜单「管理 API」）双 Tab：

| Tab | testId | 组件 | 能力 |
|-----|--------|------|------|
| 模型接入配置 | `ai-config-tab-models` | `ModelConnectionsTab` | CRUD modelConnection、测试连通、legacy profile 只读 |
| 功能绑定与任务规则 | `ai-config-tab-rules` | `CapabilityRulesTab` | 槽位→modelConnection 绑定；任务规则 draft/check/publish/rollback/use-builtin/import-markdown/test-run |

**Admin API（H2 新增）：**

| Method | Path | 用途 |
|--------|------|------|
| GET/POST | `/api/admin/model-connections` | 列出/创建模型接入 |
| GET/PATCH/DELETE | `/api/admin/model-connections/[connectionId]` | 单连接 CRUD |
| POST | `/api/admin/model-connections/[connectionId]/test` | 连通性测试 |
| GET/PUT | `/api/admin/ai-model-bindings` | profileSlot ↔ modelConnectionId |
| GET | `/api/admin/ai-task-rules` | 全部 capability 规则摘要 |
| GET | `/api/admin/ai-task-rules/[capabilityId]` | 单 capability 规则详情 |
| PUT | `/api/admin/ai-task-rules/[capabilityId]/draft` | 保存草稿 |
| POST | `/api/admin/ai-task-rules/[capabilityId]/check` | 静态校验 |
| POST | `/api/admin/ai-task-rules/[capabilityId]/publish` | 发布版本 |
| POST | `/api/admin/ai-task-rules/[capabilityId]/rollback` | 回退版本 |
| POST | `/api/admin/ai-task-rules/[capabilityId]/use-builtin` | 恢复内置规则 |
| POST | `/api/admin/ai-task-rules/[capabilityId]/import-markdown` | 导入 Markdown 规则 |
| POST | `/api/admin/ai-task-rules/[capabilityId]/test-run` | 管理员试跑（resolveAiExecutionPlan） |
| GET | `/api/admin/ai-task-rules/[capabilityId]/versions` | 版本历史 |

旧版：`GET/PUT /api/admin/api-configs` + `POST .../test`；`GET /api/ai-capabilities/availability`。

**运行时（文本生成）：** `run-generation.ts` → `resolveAiExecutionPlan` → 单次 Provider 调用。`script.split` 等 job 持久化 H2 元数据（`projects/{id}/text-generations/*.json`）：

| 字段 | 说明 |
|------|------|
| `capabilityId` | 如 `script.split.generate` |
| `taskRuleSource` | `builtin` \| `custom` |
| `taskRuleVersion` | 已发布版本号（builtin 为 null） |
| `taskRuleHash` | 规则内容 SHA-256 |
| `modelConnectionId` | 实际使用的模型接入 ID |
| `systemPolicyVersion` | 平台系统策略版本 |
| `outputContractVersion` | 不可变输出契约版本 |
| `inputFingerprint` | 动态输入指纹 |

存储：`ai-model-connections.json`、`ai-task-rules.json`（与 legacy `generation-api-configs.json` 并存）。架构：`docs/AI_TASK_RULES_ARCHITECTURE.md`。

---

## 2. 功能按钮总表（主要）

| 页面 | 文案 | 组件 | Handler | API | 角色 | 状态 |
|------|------|------|---------|-----|------|------|
| 首页 | 登录 | HeaderLoginPanel | submit | POST /api/auth/login | 公开 | 真实 |
| 项目管理 | 新建项目 | CreateProjectWizardDialog | create | POST /api/projects | ADMIN | 真实 |
| 管理/工作台 | 资产库 | AssetManagementWorkspace | Link/save | assets-draft | 含 CE | 真实 |
| 管理/工作台 | 资产设计确认 | EpisodeAssetDesignWorkspace | Link | asset-designs | OWNER/ADMIN | 真实 |
| 管理/工作台 | 提取/重新提取 | EpisodeAssetDesignWorkspace | stream | text-generations → apply | OWNER/ADMIN | active |
| 管理/工作台 | 取消生成 | EpisodeAssetDesignWorkspace | abort+cancel | text-generations cancel | OWNER/ADMIN | 真实 |
| 管理/工作台 | 保存本集资产 | EpisodeAssetDesignWorkspace | save | PUT asset-designs/episodes/[id] | OWNER/ADMIN | 真实 |
| 管理/工作台 | 确认本集资产 | EpisodeAssetDesignWorkspace | confirm | POST confirm | OWNER/ADMIN | 真实 |
| 管理/工作台 | 查看本集剧本 | EpisodeAssetDesignWorkspace | modal | 无 | OWNER/ADMIN | 真实 |
| 管理/工作台 | 手动添加 | EpisodeAssetDesignWorkspace | dialog | 本地 draft | OWNER/ADMIN | 真实 |
| 管理/工作台 | 资产库模块 nav | AssetModuleNav | Link | — | OWNER/ADMIN（CE 仅 library nav） | 真实 |
| 管理 | 上传 TXT/DOCX/MD | ScriptUploadPanel | import | import-* | OWNER/ADMIN | 真实 |
| 管理 | 生成故事 | StoryInputPanel | stream | text-generations (story) | OWNER/ADMIN | active |
| 管理 | 生成剧本大纲 | StoryInputPanel | stream | text-generations (outline) | OWNER/ADMIN | active |
| 管理 | 根据大纲生成剧集 | StoryInputPanel | blocked | planned 拒绝 | OWNER/ADMIN | planned |
| 管理 | 继续生成 | StoryCreationWorkspace | disabled | — | OWNER/ADMIN | planned Stub |
| 管理 | API/AI 配置 | ApiManagePanel | save/test | admin/model-connections + ai-task-rules + api-configs | SYSTEM_ADMIN | 真实 |
| 管理 | 模型接入 Tab | ModelConnectionsTab | CRUD/test | `/api/admin/model-connections` | SYSTEM_ADMIN | H2 |
| 管理 | 任务规则 Tab | CapabilityRulesTab | draft/publish/rollback | `/api/admin/ai-task-rules/*` | SYSTEM_ADMIN | H2 |
| 工作台/管理 | 图片/音频上传清除 | AssetImageUpload / AssetAudioUpload | upload/clear | images/audio | 含 CE | 真实 |
| 分镜 | 确认剧本 / 生成分镜 / 确认分镜 | ProductionPanel 等 | confirm/generate | storyboard-workspace | storyboard | 真实 |
| 镜头 | 生成本镜头视频 | ShotVideoGenerationButton | precheck→generate | generate-video | video | Mock/付费 |
| 分镜 | 一键生成本集视频 | EpisodeVideoGenerationButton | batch | generate-videos | video | 真实 |

**G1-UI 契约（单元测试 verified）：** 无「查看资产库」冗余按钮；有「查看本集剧本」；左窄 + amw 卡片样式。

**付费：** `aliyun-wan27` 需 `confirmPaidGeneration` + `ALLOW_PAID_GENERATION=true`；否则 403。

---

## 3. API 总表（活跃为主）

完整 67 routes 见 Master 第 17 章。高频：

| Method | Path | 权限 | UI |
|--------|------|------|-----|
| POST | `/api/auth/login` | public | ✅ |
| GET/POST | `/api/projects` | mgmt / admin create | ✅ |
| GET/PUT | `.../story-draft` / `.../script-draft` | mgmt project | ✅ |
| POST | `.../script-draft/import-{txt,docx,markdown}` | mgmt project | ✅ |
| GET/PUT | `.../assets-draft` | workspace asset | ✅ library |
| GET/PUT | `.../asset-designs/episodes/[episodeId]` | mgmt project | ✅ design |
| POST | `.../apply-generation` / `.../confirm` | mgmt project | ✅ design |
| PUT/GET/DELETE | `.../assets-draft/images|audio/[assetId]` | workspace asset | ✅ |
| POST | `.../text-generations` | session+role | ✅ 故事/大纲/资产设计 |
| GET/PUT | `/api/admin/api-configs` | SYSTEM_ADMIN | ✅ legacy profile |
| GET/POST | `/api/admin/model-connections` | SYSTEM_ADMIN | ✅ H2 |
| GET/PUT | `/api/admin/ai-model-bindings` | SYSTEM_ADMIN | ✅ H2 |
| GET/POST | `/api/admin/ai-task-rules/*` | SYSTEM_ADMIN | ✅ H2 |
| GET | `/api/ai-capabilities/availability` | session | ✅ |
| GET/PUT | `/api/workflow` | video canvas | ✅ |
| POST | `.../generate-video` / `.../generate-videos` | video canvas | ✅ |
| POST | `.../asset-matches/*` | — | **deprecated** |

---

## 4. 核心类型（索引）

| 类型 | 路径 |
|------|------|
| `AuthUser` / `EffectiveProjectRole` | `src/auth/types.ts`, `roles.ts` |
| `ScriptDraft` / `ScriptEpisode` | `src/projects/script/types.ts` |
| `CharacterAsset` 等 | `src/projects/assets/types.ts` |
| `EpisodeAssetDesignRecord` | `src/projects/assets/episode-design/types.ts` |
| `EpisodeProduction` / `StoryboardShot` | `src/projects/storyboard/types.ts` |
| `GenerationRecord` | `src/video-generation/types.ts` |
| `AiCapabilityDefinition` | `src/ai-config/capabilities.ts` |

---

## 5. 关键函数

| 主题 | 函数 | 路径 |
|------|------|------|
| 有效权限 | `resolveEffectiveProjectRole` | `auth/effective-role.ts` |
| CE design 门禁 | `assertWorkspaceAssetDesignPage`（= 资产库，**允许 CE**） | `auth/page-guards.ts` |
| 项目管理 owner | `requireActualProjectOwner` | `auth/require-access.ts` |
| 智能分集 | `script.split.generate` **active**；apply-split / confirm-split | ScriptCreationWorkspace |
| 资产设计确认 | `confirmEpisodeAssetDesign` / `atomicWriteTwoJsonFiles` | `episode-design/confirm.ts` |
| 内容指纹 | `getScriptEpisodeContentFingerprint` | `episode-design/fingerprint.ts` |
| 视频预检 | `getShotVideoBlocker` / `listShotVideoBlockers` | `shot-video-precheck.ts` |
| AI 执行计划 | `resolveAiExecutionPlan` | `ai-config/execution-plan.ts` |
| Prompt 四层组装 | `assembleTextSystemPrompt` / `assembleUntrustedUserData` | `ai-config/prompt-assembly.ts` |

---

## 6. 测试地图

| 功能 | 测试文件 | 类型 |
|------|----------|------|
| 权限 | `src/auth/__tests__/*` | 单元 |
| 资产双模块路由 | `asset-module-routes.test.ts` | 单元 |
| G1-UI 契约 | `episode-asset-design-ui.test.ts` | 单元 |
| 按集设计 API/store | `episode-design/__tests__/*` | 单元/路由 |
| 资产图片/音频 | `asset-image-routes.test.ts`, `asset-audio-routes.test.ts` | 单元 |
| 剧本导入 | `script-txt-*.test.ts`, `script-docx-*.test.ts`, `script-markdown-*.test.ts` | 单元 |
| 故事/大纲 | `story-text-generations-route.test.ts`, `script-outline-route.test.ts` | 路由 |
| 分镜/视频 | `creation-flow.test.ts`, `storyboard-layout-video.test.ts`, `video-generation/__tests__/*` | 单元 |
| PostgreSQL | `postgres-project-store.test.ts` 等 | **仅 test:postgres** |
| 浏览器 Smoke | `scripts/smoke-*-browser-seed.ts` + Cursor browser | **手工；非 vitest 门禁** |

**Vitest：** H2 门禁 **100 files / 755 tests passed**（见 Master 第 26 章）。  
**浏览器：** H2 Smoke（2026-07-29，:3043）✅ **29/29**；H1-CLOSE（:3042）✅；G1-R 完整浏览器 **未完成**。

**data/：** 历史快照 **844** / `5d645e99…`；VERIFY 观测 **847** / `2b51d433…`（均非永久基线；`scripts/hash-app-data.ts`）；事件 OPEN/NON-BLOCKING（见 `H1_CLOSE_HANDOFF_PATCH.md`）
