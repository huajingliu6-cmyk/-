# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定基线**：以 `git log -1` 为准。阶段 3C-B 提交前基线为 `e2e6abc`（阶段 3C-A）。
- **页面入口**：
  - `/` — 入口
  - `/login` — 登录
  - `/workflow` — 主工作台（React Flow 画布）
- **本地启动命令**：

```bash
npm install
npm run dev
```

打开本地开发地址（默认 `http://localhost:3000`）。更多说明见根目录 `README.md`。

> 注意：本仓库使用的 Next.js 版本与常见旧文档存在差异。写代码前应查阅 `node_modules/next/dist/docs/` 与仓库 `AGENTS.md`。

---

# 当前架构

| 路径 | 职责 |
|------|------|
| `src/workflow` | React Flow 工作台 UI 与领域：节点组件、提示栏、确认抽屉、资产库、WorkflowDocument schema/migrate、store、自动保存、上传与引用解析。 |
| `src/video-generation` | 视频生成领域层：`VideoProvider` 抽象、Mock / 万相 2.7 Provider、能力表、参数校验、GenerationRecord 存储、转存、requested/provider/actual 对比、Mock 源校验、Range 服务、浏览器 metadata 写回。 |
| `src/video-generation/reference-media` | 参考素材候选收集、自动/手动选择解析、首帧独立解析（阶段 3C-A）。 |
| `src/app/api/generations` | 异步生成 HTTP API：创建、查询（含轮询刷新）、取消、重试、转存、浏览器 metadata PATCH；公开配置不含密钥。 |
| `src/app/api/generated-videos` | 开发态中间 MP4 静态读取（Mock 写出后、转存前的临时文件服务）。 |
| `src/app/api/assets` | 本地资产上传 / 读取 / 删除；`generatedVideo` 经 assetId + `generationId`/`projectId` 校验后支持 HTTP Range。 |
| `data/workflows` | 本地 WorkflowDocument JSON（开发存储）。 |
| `data/assets` | 本地资产二进制（UUID 文件名，已 gitignore）。 |
| `data/generations` | GenerationRecord JSON（已 gitignore，仅保留 `.gitkeep`）。 |
| `data/generated-videos` | Mock / 转存中间 MP4（已 gitignore，仅保留 `.gitkeep`）。 |
| `data/mock` | 本地可播放 Mock 源（`mock-video.mp4` 已 gitignore；仅跟踪 `.gitkeep` / README）。 |

生产环境：**不要**依赖 Vercel 等平台的本地文件系统持久化视频；应改为对象存储（OSS / Supabase Storage 等）。

---

# 已完成功能

- React Flow 工作台（工具栏、资产库、画布、属性面板、分镜栏）
- 节点类型：角色、场景、图片、文本、音频、道具、视频镜头（VideoShot）等
- `WorkflowDocument` 持久化、schema 与迁移（当前 **version = 4**）
- 自动保存（工作流写回 `data/workflows`；**不会**触发生成）
- 本地资产上传（禁止把 base64 / `blob:` 写入持久化文档）
- `VideoProvider` 抽象（`src/video-generation/provider`）
- `MockVideoProvider`（默认）
- `AliyunWan27VideoProvider`（骨架已接，默认不启用付费）
- `modelCapabilities`（分辨率、比例、时长、参考素材上限等）
- 分辨率 / 画面比例 / 视频时长校验（含参考视频时的时长上限）
- 异步 generation API（创建、查询、取消、重试、转存）
- 付费双门闩：`ALLOW_PAID_GENERATION` + 请求体 `confirmPaidGeneration`
- **阶段 3A 已完成**：合法 Mock MP4、Range 播放、浏览器 metadata、转存完整性
- **阶段 3B 已完成**：requested / provider / actual 对照派生视图；Mock `overallStatus=mockOnly`；时长容差 0.35s
- **阶段 3C-A 已完成**（领域逻辑，无勾选 Drawer UI）：
  - `referenceSelectionMode`: `"auto"` \| `"manual"`
  - `selectedReferenceAssetIds`：手动模式的选择与**发送顺序**唯一来源；空数组≠auto
  - migrate 保留选择；WorkflowDocument v4
  - `collectReferenceMediaCandidates` / `resolveReferenceMediaSelection` / `resolveFirstFrame`
  - `maxReferenceMedia` / `maxFirstFrames` 唯一来自 `ModelCapability`（无硬编码 fallback 5 作为业务上限）
  - 未加载能力时：`MODEL_CAPABILITY_NOT_LOADED`，客户端禁用生成
  - 超限不静默截断；服务端按最新工作流重收集候选并校验
  - 首帧不占普通参考上限
  - `orderedReferenceMedia` 驱动 Provider payload 与 Prompt 编号
  - Store：`setReferenceSelectionMode` / `setSelectedReferenceAssetIds` / `setReferenceMediaSelection`
- **阶段 3C-B 已完成**（选择面板与确认集成；浏览器人工验收已通过）：
  - `ReferenceMediaSelectionDrawer`（草稿保存/取消、分组浏览、上移下移、首帧独立区）
  - 入口：`VideoShotNode` 摘要、`VideoPromptPanel`、「生成确认」未完成时跳转
  - `buildReferenceMediaSelectionView` / draft helpers / `prepareReferenceMediaSelectionBundle`（复用 3C-A，无第二套算法）
  - capability 缺失禁止保存与生成；UI 不写死上限、无 fallback 5
  - `setReferenceMediaSelection` 原子写入 mode+IDs；**全局 Undo/Redo 尚未实现**（工具栏占位）
  - 顺带加固连接规则：多参考边合法；禁止镜头→素材反向连；空句柄去重（避免误报「非法连接」）
- `generatedVideo` 类型的 `AssetRecord`
- GenerationRecord 上的 requested / provider / actual 字段与 `compare-params`
- 自动化测试：见 `src/video-generation/__tests__/` 与 `src/workflow/__tests__/`（数量以本文件「当前验证结果」为准）

---

# 参考素材选择语义（3C-A）

详见 `docs/reference-media-selection.md`。

| 模式 | 行为 |
|------|------|
| auto | 不以 selected 为权威；eligible≤上限则全选；>上限 → `REFERENCE_SELECTION_REQUIRED`，不截前 N |
| manual | selected 为唯一顺序来源；`[]`=明确选零项 |

生成链路：

```
load WorkflowDocument
→ collectReferenceMediaCandidates
→ resolveFirstFrame
→ resolveReferenceMediaSelection
→ buildVideoGenerationInput（orderedReferenceMedia）
→ buildInputSummary / validateGenerationSettings（按最终 selected 计数）
→ resolveProviderAssets
→ buildWan27Request
```

权限范围（非生产级多用户隔离）：可校验项目 `projectId`、连接边、AssetRecord/MIME/临时 URL；**无**完整 userId RLS。

---

# 视频生成调用链

主路径（镜头节点选中后的提示栏）：

1. **`VideoPromptPanel`**：用户填写提示词与参数 → 打开确认抽屉 → 提交。
2. **`POST /api/generations`**：从最新工作流构建输入（选择以节点数据为准）→ `submitVideoGeneration`。
3. **`VideoProvider`**：默认 `MockVideoProvider`；仅当环境配置为 `aliyun-wan27` 且通过付费门闩时走万相。
4. **Provider task** → `GenerationRecord.providerTaskId`。
5. **Polling**：`GET /api/generations/[generationId]` → `refreshGenerationStatus`。
6. **`transferRemoteVideoToLocal`**：下载 / 复制 → 完整性校验 → 登记 `generatedVideo` 资产。
7. **结果 UI**：`VideoShotNode` 封面预览 + 播放按钮 → `VideoResultDrawer` / `VideoResultPlayer`。
8. **Metadata**：浏览器 `loadedmetadata` → 可选 `PATCH .../metadata`。
9. **参数对照**：`buildGenerationParameterComparisonView(record)` 派生三列对照。

相关源码锚点：

- 参考素材选择：`src/video-generation/reference-media/`
- 参数对照：`src/video-generation/parameter-comparison-view.ts`
- 对照说明：`docs/generation-parameter-comparison.md`
- 参考素材说明：`docs/reference-media-selection.md`
- 配置说明：`docs/mock-video-setup.md`

---

# 安全规则

- `VIDEO_PROVIDER` **默认 `mock`**（见 `.env.example` 与 `src/video-generation/provider/config.ts`）。
- `ALLOW_PAID_GENERATION` **默认 `false`**。
- 真实万相请求还需要客户端显式 `confirmPaidGeneration=true`，且服务端门闩全部通过。
- `DASHSCOPE_API_KEY` / Workspace 等 **只能在服务端**读取；禁止 `NEXT_PUBLIC_` 前缀暴露密钥。
- 客户端通过 `GET /api/generations` 只能看到公开配置（含 `hasApiKey: boolean`），**不能**读取密钥明文。
- 页面打开 **不会**自动生成；自动保存 **不会**触发生成。
- `build` 与 `test` **不允许**访问真实外部生成接口；单元测试使用 mock fetch / 本地逻辑。
- **不允许** Agent 自动进行付费测试；付费 e2e 仅人工、可选手动执行，测完立刻改回 mock。
- **不允许**把视频文件、generation 任务 JSON、用户素材、密钥或 `.env.local` 提交到 Git。

---

# 当前验证结果

阶段 3C-B 最终验收（以提交前命令结果为准）：

| 命令 | 预期 |
|------|------|
| `npm run lint` | 退出码 0 |
| `npx eslint . --max-warnings=0` | 退出码 0 |
| `npm run typecheck` | 退出码 0 |
| `npm test` | 退出码 0；**124** 项（含 3C-B UI/view/draft 与连接规则测试） |
| `npm run build` | 退出码 0 |

安全配置：默认 `VIDEO_PROVIDER=mock`、`ALLOW_PAID_GENERATION=false`；未进行真实付费生成、未 push。

浏览器人工验收：auto/manual、草稿取消/保存、顺序、失效项、首帧、确认抽屉、Mock 生成与 Provider 顺序一致；无真实阿里云/付费请求。

---

# 尚未完成的功能

按建议顺序：

1. Mock 完整端到端验收与真实 Provider 启用前安全审计
2. 全局编辑器 Undo/Redo（独立阶段；**不是** 3C-B 范围）
3. 真实万相最低成本人工付费测试（可选；禁止 Agent 自动执行）

---

# 下一阶段

**名称：** Mock 完整端到端验收与真实 Provider 启用前安全审计

约束延续：默认 mock、禁止自动付费、不 push、不 eslint-disable、不用 `any` / `@ts-ignore`。

---

# 已知风险

- `data/` 目录只适合本地开发，不适合多实例或无状态部署。
- Vercel 等平台文件系统不能作为生产视频存储。
- 生产环境需要 OSS 或 Supabase Storage（或同类对象存储）。
- 浏览器读取的 metadata **不是**服务端可信验证，只能作为对比辅助。
- **requested** 参数不能冒充 **actual** 参数；UI 与记录必须区分三层。
- 真实 Provider 尚未进行付费端到端测试。
- 万相远程结果 URL 可能有时效（约 24 小时）；成功后应尽快转存。
- 参考视频在真实 Provider 下通常需要可公网访问的 HTTPS URL；纯 localhost 资产可能被拦截。
- 当前权限校验仅为项目/节点/边/资产一致性，**不是**生产级多用户隔离。
- **全局 Undo/Redo 尚未实现**：选择保存仅为原子 Store action；工具栏 Undo/Redo 仍为占位，后续需独立编辑器阶段完成。

---

# 相关文档

- `README.md` — 启动与工作台结构
- `docs/mock-video-setup.md` — 本地 Mock MP4 配置
- `docs/generation-parameter-comparison.md` — requested/provider/actual 对照
- `docs/reference-media-selection.md` — 参考素材选择（3C-A/B）
- `docs/video-provider-aliyun-wan27.md` — 万相 2.7 Provider
- `.env.example` — 环境变量模板（无密钥）
- `AGENTS.md` / `CLAUDE.md` — Next.js 版本注意

---

*文档对应阶段 3C-B 完成态。若后续功能提交改变行为，请同步更新本文件。*
