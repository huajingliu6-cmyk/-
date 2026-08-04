# CURRENT_PROJECT_HANDOFF — 当前项目概览

> **`docs/CURRENT_PROJECT_MASTER_HANDOFF.md` 是唯一完整技术交接基线。**  
> 本文件为其中文 **中等篇幅概览**（非完整版）；细节、全路由表、67 API、附录与门禁实测见 Master。  
> 旧报告（如 `docs/agent-handoff.md`）仅保留历史追溯价值。事实来源：**当前工作区代码**。

| 项 | 值 |
|----|-----|
| 产品名称 | Lumina Story（Lumina Story / 分镜创作工作台） |
| 代码目录 | `c:\Users\江城的助手\Downloads\24\infinite-canvas` |
| 当前分支 | `feat/react-flow-migration` |
| 当前 HEAD | `a8149a0a6e791d9fc2f2ac431a3773ace821870a` |
| 工作区 | **Dirty: YES**（`git status --short` 共 **120** 行） |
| 文档生成时间 | 2026-07-29 Asia/Shanghai（H2-FINAL-STATUS-PATCH） |
| H2 功能验收 / 批次总状态 | **COMPLETE** / **COMPLETE**（不以 data 哈希 PARTIAL） |
| `data/` | 历史快照 **844** / `5d645e99…`；VERIFY 观测 **847** / `2b51d433…`（均非永久基线）；事件 **OPEN/NON-BLOCKING**；在用业务库（见 `H1_CLOSE_HANDOFF_PATCH.md`） |
| Node / npm | v24.18.0 / 11.16.0 |
| Next.js / React | 16.2.11 / 19.2.4 |
| Prisma / Vitest | 6.19.0 / ^3.2.4 |
| `PERSISTENCE_DRIVER` 默认 | `file` |
| `VIDEO_PROVIDER` / `ALLOW_PAID_GENERATION` / `TEXT_LLM_PROVIDER` 默认 | `mock` / `false` / `mock` |
| `TEST_DATABASE_URL` | 仅 `.env.example`；当前 shell **unset** |
| Docker / PostgreSQL | Client 29.6.1；Engine **未完全验证**；`test:postgres` **未验证** |

**相关文档：** [续作入口（优先）](./AGENT_CONTINUE_HANDOFF.md) · [Master 完整基线](./CURRENT_PROJECT_MASTER_HANDOFF.md) · [按钮地图](./CURRENT_CODE_AND_BUTTON_MAP.md) · [AI 审计](./AI_BUTTON_API_CONFIG_AUDIT.md) · [新对话开场](./NEW_CHAT_BOOTSTRAP.md) · [SD2 专题](./SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md)

---

## ⚠ 安全红线（未提交工作区）

**禁止：** `git reset` / `git clean` / `git checkout -- .` / `git restore .` / 盲目 `git add .` / 删除 `data/` / `npm run db:legacy:import --apply` / 自动 commit / push。

测试必须隔离 `APP_DATA_DIR`（`vitest.setup.ts`）。不得修改真实 `.env` 中 `VIDEO_PROVIDER` / `ALLOW_PAID_GENERATION` 默认策略。

---

## 1. 产品流程（摘要）

```
首页 `/` → 登录（/?login=1）→ `/app` 门户
  → 平台工作台 `/app/workspace` → 项目 `/app/workspace/projects/[id]`
       资产 `/…/assets`：Owner/Admin → design；CE → library；双模块 nav（Owner/Admin）；CE 仅 library
  → 项目管理 `/app/projects`（仅 SYSTEM_ADMIN 创建）
       故事/剧本 → 管理资产 `/…/assets` redirect → `/assets/design` + `/assets/library`
       分镜 → 单镜/整集视频
  → React Flow 画布 `/workflow?projectId=`（独立于 /app 壳；分镜页不自动跳转）
```

**三个表面：** 平台工作台（CE 主入口；无剧本）· 项目管理（全流程）· 视频画布（React Flow）。

---

## 2. 路由摘要

| 区域 | 关键路由 | 状态 |
|------|----------|------|
| 公开 | `/` 首页+登录 | 真实 |
| 工作台 | `/app/workspace`、`/workspace/projects/[id]` | 真实；**无剧本** |
| 工作台资产 | `/…/assets` → design 或 library；`/assets/design`、`/assets/library` | 双模块；**CE 可 design**（H1） |
| 项目管理 | `/app/projects`、`/projects/[id]`、story/script/storyboard | 真实 |
| 管理资产 | `/…/assets` → **redirect design**；design + library | 双模块 G1 |
| 画布 | `/workflow` | 真实 |
| Stub | `/app/team`、`enterprise-assets`、`showcase`、`guide` | ModulePlaceholder |

登录：`/login` 已删；middleware → `/?login=1`。PDF 剧本：**产品不支持**（非待开发）。

完整路由表见 Master 第 3 章。

---

## 3. 权限矩阵

有效角色（`EffectiveProjectRole`）：SYSTEM_ADMIN → PROJECT_OWNER（`ownerId`，非 Member）→ CARD_ENGINEER → NONE。

| 能力 | SYS_ADMIN（非 owner） | OWNER | CE | NONE |
|------|:---:|:---:|:---:|:---:|
| 工作台 | Y* | Y | Y（已分配） | N |
| 项目管理列表/创建 | Y / Y | Y / N | N | N |
| 项目内容（详情/剧本/资产/分镜/成员） | **N** | Y | N | N |
| 工作台资产库 + 设计 | Y* | Y | **Y** | N |
| 剧本/故事/分镜/视频（管理） | N | Y | N | N |

\*非 owner 的 SYSTEM_ADMIN：可进系统级能力与列表，**不可**操作他人项目内容。  
CE 访问工作台 design：**允许**（`assertWorkspaceAssetDesignPage` = 资产库门禁）。  
管理端项目页：`requireActualProjectOwner`。

`workspaceFeaturesForRole`：OWNER → assets|storyboard|video；CE → assets only。

---

## 4. 模块状态

| 模块 | 状态 |
|------|------|
| 首页 / 登录 / 权限 / 成员 | ✅ |
| 故事生成 + 大纲（text-generations） | ✅ |
| 剧本 TXT/DOCX/MD 导入 | ✅ |
| 根据大纲生成剧集 / 续写 | 🔴 **planned**（E2 暂停） |
| 剧本/故事导出 Word | 🔴 NON_AI Stub |
| AI 配置中心 + H2 模型/规则 | ✅ |
| **H2-AI-CONTROL**（modelConnection、任务规则 draft/publish/rollback、`resolveAiExecutionPlan` 单次调用、Admin 双 Tab） | ✅ **COMPLETE** |
| **资产双模块**（design + library，管理端 + 工作台） | ✅ |
| **按集资产设计**（G1） | ✅ |
| **G1-UI**（布局/按钮契约） | ✅ **代码 verified** |
| 资产元数据 + 图片/音频二进制 | ✅ |
| 分镜两步 + 单镜/整集视频 Mock | ✅ |
| React Flow 画布 | ✅ |
| 文本积分（credits.json） | 🟡 文件账本 |
| 视频 registry requiresCredits vs 实现 | 🟡 不一致 |
| PostgreSQL | ⚠️ 仅项目 CRUD 可选；**未验证** |
| 团队/企业库/展示/指引 | 🔴 Stub |

---

## 5. 资产双模块（管理 + 工作台）

| 模块 | 管理端 | 工作台 | 组件 |
|------|--------|--------|------|
| 设计确认 | `/app/projects/[id]/assets/design` | `/app/workspace/…/assets/design` | `EpisodeAssetDesignWorkspace` |
| 资产库 | `/…/assets/library` | `/…/assets/library` | `AssetManagementWorkspace` |
| 入口 | `/assets` → design | `/assets` → design（Owner/Admin）或 library（CE） | `AssetModuleNav` |

- 存储：`episode-asset-designs.json`（设计）与 `assets.json`（库）分离；确认后 `create_new` 原子合并。
- 能力：`asset.episode-design.generate` · active · `episode-asset-design-text`。
- CE：**仅 library**；设计 API / 页均拒绝。
- 工作台与管理 **共用** `assets.json` + 图片/音频 API。

### G1-UI（代码已验证 COMPLETE）

| 项 | 状态 |
|----|------|
| 「查看资产库」从设计工作区移除 | ✅ REMOVED（nav 仍有「资产库」模块入口） |
| 「查看本集剧本」 | ✅ PRESENT（`data-testid="ead-view-script"`） |
| 左面板宽度 | ✅ `clamp(230px, 21vw, 280px)` |
| 右侧卡片样式 | ✅ `amw-panel` / detail styles |
| 按钮文案 | ✅ 提取/重新提取、取消生成、保存本集资产、确认本集资产、手动添加 |

---

## 6. 验证诚实性

| 范围 | 级别 |
|------|------|
| 单元 / 路由测试（Vitest） | ✅ extensive（含 episode-design、asset-module、G1-UI 契约等） |
| **Assets UI Parity 浏览器 Smoke**（2026-07-28，:3040） | 历史 scope；CE design denied **已过时** |
| **H2 浏览器 Smoke**（2026-07-29，:3043） | ✅ Admin 双 Tab + 规则生命周期 + script.split 元数据；**29/29** |
| **H1-CLOSE 浏览器 Smoke**（2026-07-29，:3042） | ✅ TXT 上传闭环 + 一键复制 + CE 单向隔离 |
| data/ 事件 | **OPEN / NON-BLOCKING**（VERIFY 观测 **847** / `2b51d433…`；历史 **844** / `5d645e99…`；不影响 H2 COMPLETE） |
| **G1-R 完整浏览器**（extract/edit/save/confirm/stale/empty/cancel/illegal JSON recover） | **未完成** — 仅有 API/unit 证据 |
| API smoke ≠ browser smoke | **必须区分** |

---

## 7. Planned / Stub

| 功能 | 状态 |
|------|------|
| `script.episodes.generate` | **planned**；UI wired；服务端 `AI_CAPABILITY_PLANNED` |
| `script.continue.generate` | **planned** Stub；按钮 disabled / toast |
| `exportScriptToWord` / `exportDocuments` | NON_AI Stub |
| `/app/team` 等四页 | ModulePlaceholder |

---

## 8. 风险（仍存在）

1. 未提交工作区（120 行）— 误 reset/clean 丢成果  
2. `data/` 运行时数据 — 勿删、勿污染  
3. 真实付费 Provider — 默认关闭  
4. 文件/PG 双源 — 仅项目可切 PG  
5. G1-R 浏览器未闭环  
6. 视频 `requiresCredits: true` 但 **不写** `credits.json`  
7. PostgreSQL / Docker Engine 未验证  
8. 直接 URL 越权 — 依赖 layout/API gate  

已关闭（相对旧报告）：分镜占位、无权限、工作台=画布、资产未落盘、故事 Stub、无按集设计、查看资产库冗余按钮等 — **均已否**。

---

## 9. 未完成项（优先级）

| 优先级 | 项 |
|--------|-----|
| P0 | **G1-R** 浏览器 smoke 闭环 |
| P1 | PostgreSQL 集成验证 |
| P2 | PostgreSQL 集成验证 |
| P3 | E2 恢复 `script.episodes.generate` |
| P4 | 剧集续写 `script.continue.generate` |
| P5 | 剧本/故事导出 |
| P6 | 团队/企业库/展示/指引 |
| P7 | 视频 credits 与 registry 对齐 |
| — | PDF **不属于待开发** |

---

## 10. 下一批次建议

1. **G1-R 残余浏览器 UI Smoke**（extract → save → confirm → stale → cancel → illegal JSON recover；隔离 APP_DATA_DIR；勿把 API smoke 冒充 browser smoke）  
2. PostgreSQL 验证（Engine + `test:postgres`）  
3. E2 恢复（若产品恢复 `script.episodes.generate`）  
4. PostgreSQL 验证（`docker compose` + `test:postgres`）  
5. 导出或 Stub 模块择一  

**G1-UI 已完成** — 不应重复 G1-UI；优先 G1-R closure。

---

## 11. 运行门禁

门禁实测见 **`docs/CURRENT_PROJECT_MASTER_HANDOFF.md` 第 26 章**：lint / eslint / typecheck / test（**100 files / 755 passed**）/ build / diff-check；H2 浏览器 Smoke **29/29**（:3043）。`test:postgres` 未运行。

已记录：`npx tsx scripts/hash-app-data.ts` → VERIFY 观测 **847** / `2b51d433…`（时间点；非永久基线）；历史快照 **844** / `5d645e99…`。产品持续使用期间全目录哈希可正常变化；核心验收为自动化 `APP_DATA_DIR` 隔离。

测试隔离：`vitest.setup.ts` 每 worker `mkdtemp` → `APP_DATA_DIR`。

---

## 12. 快速索引

- 完整基线：**`docs/CURRENT_PROJECT_MASTER_HANDOFF.md`**
- 按钮 / 调用链：**`docs/CURRENT_CODE_AND_BUTTON_MAP.md`**
- AI capability 审计：**`docs/AI_BUTTON_API_CONFIG_AUDIT.md`**
- H2 任务规则架构：**`docs/AI_TASK_RULES_ARCHITECTURE.md`**
- 新对话开场：**`docs/NEW_CHAT_BOOTSTRAP.md`**
