# Batch H1 / H1-CLOSE 交接补丁（覆盖旧基线中已失效事实）

> 写入时间：2026-07-29 Asia/Shanghai（含 **H2-FINAL-STATUS-PATCH**）  
> 本文件内容优先于同仓库旧段落中与之冲突的描述。

---

## 0. 官方状态分层（权威）

### Batch H1-CLOSE 总状态：**PARTIAL**

原因**仅为**：历史真实 `data/` 来源无法完整追溯。

### Batch H2-AI-CONTROL

| 项 | 状态 |
|----|------|
| 功能验收 | **COMPLETE** |
| 批次总状态 | **COMPLETE** |

依据（摘要）：模型连接 / 绑定 / Markdown 任务规则 / 草稿·发布·历史·回滚·试运行；无额外「先理解规则」调用；四层运行时已接线；**100** files / **755** tests；Browser Smoke **29/29**（:3043，隔离 `APP_DATA_DIR`）；全量门禁通过；**未发现** H2 测试写入真实 `data/`。

### H1 功能验收状态：**COMPLETE**

- 主理人现场 TXT 上传、分集、编辑、确认通过；
- 单集文本资产提取、素材设计提示词、一键复制、Mock 素材生成通过；
- 工作台单向同步和本地数据隔离通过；
- Owner、非 Owner Admin、CARD_ENGINEER、陌生用户权限浏览器验收通过；
- 全量自动化测试及工程门禁通过。

### 数据完整性事件状态：**OPEN / NON-BLOCKING**

| 项 | 值 |
|----|-----|
| 历史快照（仅追溯） | **844** / `5d645e996eb87a7f1ea36de6d10d9f8a4bd411ca61d1991fa2d84458afe6ffb9` |
| H2-DATA-ANCHOR-VERIFY 结束时观测快照 | **847** / `2b51d4336777093f8d16a81803ec66f77db0860382b533413eeceb8fbc3722c9` |
| 是否永久固定 / 干净基线 | **否** — 观测值不是永久固定基线；不得称「干净基线」 |
| 真实 `data/` 性质 | **正在使用的业务数据库**；`:3000` 合法产品操作可使文件数与全目录哈希**正常变化** |
| 后续批次全目录哈希 | **不再要求**永远保持某一个全目录哈希 |
| 处理策略 | **不删除或不覆盖** `script.json`、`workspace/snapshot.json` 或来源不明文件；**不**尝试恢复整个 `data/` 到 844 |
| 测试 / Smoke | **必须**隔离 `APP_DATA_DIR`；非 3000 端口；不停止/复用用户 :3000 |
| 对 H2 影响 | **不影响** H2 **COMPLETE**；**不阻止**后续功能开发 |

#### 845 → 847 取证（H2-DATA-ANCHOR-VERIFY）

新增两个文件（真实项目业务，**:3000** 产品操作）：

- `projects/p_2e807df44a4b/drafts/script.json`
- `projects/p_2e807df44a4b/workspace/snapshot.json`

**不是** `ai-model-connections.json` / `ai-task-rules.json`（真实 `data/` 中**目前不存在**这两个 H2 AI 配置文件）。

未发现：H2 Smoke 污染；GET 自动落盘；打开后台自动创建配置；built-in 读取写文件；`resolveAiExecutionPlan` 写文件。

取证：`C:\Temp\h2-data-forensics\`、`C:\Temp\h2-anchor-verify-report.md`。

#### 全目录哈希硬门禁条件

仅当 **全部**满足时，才把批次前后全目录哈希一致作为硬门禁：`:3000` 已停、无用户操作、无后台写入、无其他开发进程、明确维护窗口。

产品持续使用期间：全目录哈希仅为**时间点观测**；**不是**功能批次 COMPLETE 的唯一阻断条件；核心验收改为自动化 **`APP_DATA_DIR` 隔离证明**。若发现 Smoke/测试数据进入真实 `data/` → **立即停止并定位**。

因此：

- H1 **不**标记为总 COMPLETE（历史追溯）；
- H2 **批次总状态 COMPLETE**（不以 data 哈希 PARTIAL）；
- data/ 事件继续 **OPEN / NON-BLOCKING**。

取证目录（仓库外）：`C:\Temp\h1-close-forensics\`、`C:\Temp\h2-data-forensics\`。

---

## 1. 权限（已生效）

- 项目管理业务统一：`requireActualProjectOwner`（`project.ownerId === currentUser.id`）。
- 别名：`requireProjectManagementProjectAccess` / `requireProjectOwnerOrSystemAdmin` **均转发**到 `requireActualProjectOwner`。
- **非 owner 的 SYSTEM_ADMIN** 不得操作该项目内容（页面 redirect `?denied=project-management`；API 403「仅项目主理人可操作」）。
- **CARD_ENGINEER** 拒绝全部项目管理业务；可操作**已分配项目**的工作台资产（含 **design + library**）。
- `assertWorkspaceAssetDesignPage` = `assertWorkspaceAssetPage`（**不再**拒 CE design）。
- 管理端资产图/音频 **GET** 可读：owner **或** `requireWorkspaceAssetAccess`（便于单向同步后预览）；**PUT/DELETE 仍仅 owner**。
- 工作台写操作走 `/api/workspace/...` + local；**不反向写**管理端正式草稿。

## 2. 剧本智能分集（active）

- Capability：`script.split.generate` → **active**（不是 planned）。
- API：`POST .../script-draft/apply-split`、`POST .../script-draft/confirm-split`。
- 流程：导入源文本 →「分集」→ 块边界 LLM → `proposedEpisodes` 核对 →「确认剧本」→ 正式 episodes。
- 默认/未配真实文本模型时走 Mock 启发式切集；真实语义分集需为 `script-split-text` 配置 HTTP Provider。
- `script.episodes.generate` / `script.continue.generate` 仍为 **planned**。

## 3. 资产设计链路（H1）

- 提取本集资产 → 文本资产卡（不自动出图）→「设计」→ `asset.design-prompt.generate` → 可改提示词 →「一键复制」→「生成资产」。
- `image.character|scene|prop.generate`：可生成视觉素材（Mock）。
- `audio`：未配置音频能力时返回 `AUDIO_GENERATION_UNAVAILABLE`，**禁止用 PNG 冒充音频**。
- 保存/确认本集资产；确认后同步工作台。

## 4. 工作台数据结构（单向）

- 管理正式：`projects/{id}/drafts/script.json`、`episode-asset-designs.json`、`assets.json` + 二进制。
- 工作台：`projects/{id}/workspace/snapshot.json`（上游快照）+ `workspaceLocal`（本地改动）。
- **不得**再写「管理与工作台共用 assets.json」。
- 管理 → 工作台同步；工作台操作不改管理文件哈希（H1-CLOSE Smoke 已证）。

## 5. 浏览器 Smoke（H1-CLOSE，:3042）

- 隔离 `APP_DATA_DIR`：`C:\Temp\ic-smoke-00ba98682c9fbb90-1zDgaS`（未触碰 3000）。
- 现场 TXT `<input type=file>` 上传 → 分集 → 改标题 → 确认 → 提取 → 设计 → 复制 → 生成。
- 一键复制：Clipboard API；成功文案「提示词已复制」；剪贴板内容一致。
- CE 工作台单向隔离；陌生用户 / 非 owner Admin 浏览器拒绝。

## 6. 门禁与测试（H1-CLOSE 最后一次）

| 项 | 结果 |
|----|------|
| `npm run lint` | pass |
| `npx eslint . --max-warnings=0` | pass |
| `npm run typecheck` | pass |
| `npm test -- --maxWorkers=1` | **95** files / **735** passed / 0 failed / 0 skipped |
| `npm run build` | pass |
| `git diff --check` | pass |
| data/ 起止哈希（H1-CLOSE） | 均为监控锚点 **845** / `9a10c34c…` |

## 7. 产品侧仍开放项（与 data/ 事件独立）

- `script.episodes.generate` / `script.continue.generate` planned。
- 剧本/故事导出 NON_AI Stub；团队/企业库/展示/指引 Stub。
- PostgreSQL 路径未在本批验证。
- 工作流画布 `requireVideoCanvasAccess` 与管理分镜 owner 规则需继续区分（管理 storyboard API 已 owner-only）。

## 8. H2-AI-CONTROL 状态指针

| 项 | 值 |
|----|-----|
| 批次 | **H2-AI-CONTROL** |
| 功能验收 | **COMPLETE** |
| 批次总状态 | **COMPLETE** |
| 浏览器 Smoke | :**3043**；隔离 `APP_DATA_DIR`；`C:\Temp\h2-browser-report.json`；**29/29**；未触碰 :3000 |
| 自动化测试 | **100** files / **755** passed |
| 全量门禁 | lint / eslint / typecheck / test / build / diff-check 全过 |
| 架构文档 | `docs/AI_TASK_RULES_ARCHITECTURE.md` |
| data 与 H2 | 核实确认 **非**测试污染；**不以** data 哈希将 H2 标 PARTIAL |

H2 交付：模型接入（`modelConnection`）、任务规则 draft/publish/rollback、运行时 `resolveAiExecutionPlan` 单次 Provider 调用、`ApiManagePanel` 双 Tab（模型 / 规则）。隔离环境中的存储文件为 `ai-model-connections.json` + `ai-task-rules.json`；**真实** `data/` 中目前不存在这两文件。详见 Master 第 11 章与架构文档。

## 9. 后续自动化安全规则（权威摘要）

1. Vitest / API Smoke / Browser Smoke 均隔离 `APP_DATA_DIR`；  
2. Smoke 使用非 3000 端口；不停止或复用用户 :3000；  
3. 不在真实 `data/` 创建测试项目、测试用户、Mock 配置；  
4. 自动化须拒绝 `APP_DATA_DIR` 指向仓库真实 `data/`；  
5. 发现测试数据进入真实 `data/` → 立即停止并定位；  
6. 不删除真实业务文件；不恢复整个 `data/` 到历史 844。
