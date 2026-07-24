# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定提交**：`99469e8` — `fix: reduce canvas flicker and prune dead workflow code`
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
| `src/video-generation` | 视频生成领域层：`VideoProvider` 抽象、Mock / 万相 2.7 Provider、能力表、参数校验、GenerationRecord 存储、转存、requested/provider/actual 对比。 |
| `src/app/api/generations` | 异步生成 HTTP API：创建、查询（含轮询刷新）、取消、重试、转存；公开配置不含密钥。 |
| `src/app/api/generated-videos` | 开发态中间 MP4 静态读取（Mock 写出后、转存前的临时文件服务）。 |
| `src/app/api/assets` | 本地资产上传 / 读取 / 删除；Workflow 只存 `AssetRecord` 元数据与引用 ID。 |
| `data/workflows` | 本地 WorkflowDocument JSON（开发存储）。 |
| `data/assets` | 本地资产二进制（UUID 文件名，已 gitignore）。 |
| `data/generations` | GenerationRecord JSON（已 gitignore，仅保留 `.gitkeep`）。 |
| `data/generated-videos` | Mock / 转存中间 MP4（已 gitignore，仅保留 `.gitkeep`）。 |

生产环境：**不要**依赖 Vercel 等平台的本地文件系统持久化视频；应改为对象存储（OSS / Supabase Storage 等）。

---

# 已完成功能

- React Flow 工作台（工具栏、资产库、画布、属性面板、分镜栏）
- 节点类型：角色、场景、图片、文本、音频、道具、视频镜头（VideoShot）等
- `WorkflowDocument` 持久化、schema 与迁移
- 自动保存（工作流写回 `data/workflows`）
- 本地资产上传（禁止把 base64 / `blob:` 写入持久化文档）
- `VideoProvider` 抽象（`src/video-generation/provider`）
- `MockVideoProvider`（默认）
- `AliyunWan27VideoProvider`（骨架已接，默认不启用付费）
- `modelCapabilities`（分辨率、比例、时长、参考素材上限等）
- 分辨率 / 画面比例 / 视频时长校验（含参考视频时的时长上限）
- 异步 generation API
- 创建、查询、取消、重试、转存
- 付费双门闩：`ALLOW_PAID_GENERATION` + 请求体 `confirmPaidGeneration`
- Mock 生成极小合法 MP4（明确标记非真实 AI 视频）
- `generatedVideo` 类型的 `AssetRecord`
- GenerationRecord 上的 requested / provider / actual 字段与 `compare-params`
- 当前自动化测试：**17** 项（`src/video-generation/__tests__/wan27-provider.test.ts`）

---

# 视频生成调用链

主路径（镜头节点选中后的提示栏）：

1. **`VideoPromptPanel`**（`src/workflow/components/VideoPromptPanel.tsx`）：用户填写提示词与参数 → 打开确认抽屉 → 提交。
2. **`POST /api/generations`**（`src/app/api/generations/route.ts`）：从工作流构建输入（`buildVideoGenerationInput`）→ `submitVideoGeneration`。
3. **`VideoProvider`**（`src/video-generation/provider/index.ts` 工厂）：默认 `MockVideoProvider`；仅当环境配置为 `aliyun-wan27` 且通过付费门闩时走万相。
4. **Provider task**：写入 `GenerationRecord.providerTaskId`，状态进入 queued / processing 等。
5. **Polling**：客户端定时 `GET /api/generations/[generationId]` → `refreshGenerationStatus`（`src/video-generation/service.ts`）。
6. **`transferRemoteVideoToLocal`**（`src/video-generation/transfer-video.ts`）：下载临时 URL（或 Mock 的 `file://`）→ 写入开发态磁盘 → 登记资产。也可手动 `POST .../transfer`。
7. **`generatedVideo` AssetRecord**：`assetType: "generatedVideo"`，`mimeType: "video/mp4"`，`url` 指向 `/api/assets/{id}`。
8. **`resultAssetId` 写回节点**：`VideoPromptPanel` 在 `completed` 时 `commitNodeAssets`，更新 VideoShot 节点。
9. **结果 UI（当前缺口）**：`VideoShotNode`（`src/workflow/components/nodes/VideoShotNode.tsx`）仍用 `AssetThumb`（CSS 背景图）与 `ImageLightbox` 展示，**尚未**用 `<video>` 播放。

相关源码锚点：

- 确认抽屉：`src/workflow/components/GenerationConfirmationDrawer.tsx`
- 对比逻辑：`src/video-generation/compare-params.ts`
- 中间 MP4 路由：`src/app/api/generated-videos/[fileName]/route.ts`
- 旧同步接口 `POST /api/generate/video-shot` **已停用并抛错**（`src/workflow/lib/video-shot-generation.ts`），不得再走演示 PNG 冒充视频。

---

# 安全规则

- `VIDEO_PROVIDER` **默认 `mock`**（见 `.env.example` 与 `src/video-generation/provider/config.ts`）。
- `ALLOW_PAID_GENERATION` **默认 `false`**。
- 真实万相请求还需要客户端显式 `confirmPaidGeneration=true`，且服务端门闩全部通过。
- `DASHSCOPE_API_KEY` / Workspace 等 **只能在服务端**读取；禁止 `NEXT_PUBLIC_` 前缀暴露密钥。
- 客户端通过 `GET /api/generations` 只能看到公开配置（含 `hasApiKey: boolean`），**不能**读取密钥明文。
- `build` 与 `test` **不允许**访问真实外部生成接口；单元测试使用 mock fetch / 本地逻辑。
- **不允许** Agent 自动进行付费测试；付费 e2e 仅人工、可选手动执行，测完立刻改回 mock。
- **不允许**把视频文件、generation 任务 JSON、用户素材、密钥或 `.env.local` 提交到 Git（对应目录已 gitignore）。

---

# 当前验证结果

记录于稳定基线 `99469e8` 上的接管审计（本交接文档提交前）：

| 命令 | 结果 |
|------|------|
| `npm run lint` | 通过（退出码 0） |
| `npx eslint . --max-warnings=0` | 通过（退出码 0） |
| `npm run typecheck` | 通过（退出码 0） |
| `npm test` | 通过；**17** 项 |
| `npm run build` | 通过（退出码 0） |

安全配置：默认 mock、默认禁止付费；审计时未进行真实付费生成。

---

# 当前已知状态

- Mock 已经生成极小合法 MP4，并经转存登记为 `generatedVideo`。
- 主生成链路（`/api/generations`）**不再**使用演示 PNG 冒充视频；旧 `/api/generate/video-shot` 会直接失败。
- `VideoShotNode` 仍把 `generatedVideo` **当图片**渲染（`AssetThumb` + `ImageLightbox`）。
- 当前缺少真实 `<video>` 播放器与结果 Drawer。
- `actualWidth` / `actualHeight` / `actualDurationSeconds` 仍未通过浏览器（或其它来源）写回；创建时为 `null`，`metadataSource` 为 `"none"`。
- `compare-params` 已存在，但完整「requested / provider / actual」三组参数 UI 尚未完成。
- `selectedReferenceAssetIds` 后端字段与 schema 存在，超过 5 个参考素材时的手动勾选 UI 尚未实现；校验仍按连线素材计数。

---

# 尚未完成的功能

按建议顺序：

1. 真实 MP4 播放与结果 Drawer
2. 最终视频资产的 Range 流式读取
3. 浏览器元数据读取和写回（`actual*` + `metadataSource: "browser"`）
4. requested / provider / actual 完整展示
5. 超过 5 个参考素材时的手动选择（并与校验/resolver 对齐）
6. Mock 全流程人工验收
7. 真实万相最低成本人工付费测试（可选；禁止 Agent 自动执行）

---

# 下一阶段

**名称：** 万相 2.7 阶段 3A：真实 MP4 播放与浏览器元数据写回

**预计涉及（只描述，本交接不实现）：**

- `VideoShotNode` — 视频结果预览改为可播
- `GenerationHistoryPopover` — 历史条区分视频与图片
- `VideoResultPlayer` — 可复用播放器组件
- `VideoResultDrawer` — 结果详情 / 放大播放
- `generatedVideo` 资产内容路由 — 正确 `Content-Type` 与缓存策略
- HTTP Range — 支持浏览器 seek / 流式读取
- metadata API — 安全写回 `actualWidth` / `actualHeight` / `actualDurationSeconds`
- generation storage / service — 持久化 actual 字段与 `metadataSource`
- 单元测试 — 元数据写回与 compare 行为

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

---

# 相关文档

- `README.md` — 启动与工作台结构
- `docs/video-provider-aliyun-wan27.md` — 万相 2.7 Provider 配置与人工付费步骤
- `.env.example` — 环境变量模板（无密钥）
- `AGENTS.md` / `CLAUDE.md` — Next.js 版本注意

---

*文档对应基线：`99469e8`。若后续功能提交改变行为，请同步更新本文件。*
