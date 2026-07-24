# Agent 交接文档

本文档供新 Agent 接管时使用。事实以当前 Git、代码与本文件为准；不要依赖旧对话上下文。

---

# 项目概况

- **项目目标**：资产驱动的 AI 视频创作工作台。用户在无限画布上编排角色、场景、参考素材与视频镜头，经确认后提交异步视频生成，并将结果登记为本地 `generatedVideo` 资产。
- **技术栈**：Next.js 16、React 19、React Flow（`@xyflow/react`）、Zustand、Zod、Vitest、Tailwind CSS 4。
- **当前分支**：`feat/react-flow-migration`
- **当前稳定提交**：以本文件「当前验证结果」中记录的阶段 3A 提交为准（提交后请把 hash 写回此处）。
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
- `WorkflowDocument` 持久化、schema 与迁移
- 自动保存（工作流写回 `data/workflows`；**不会**触发生成）
- 本地资产上传（禁止把 base64 / `blob:` 写入持久化文档）
- `VideoProvider` 抽象（`src/video-generation/provider`）
- `MockVideoProvider`（默认）
- `AliyunWan27VideoProvider`（骨架已接，默认不启用付费）
- `modelCapabilities`（分辨率、比例、时长、参考素材上限等）
- 分辨率 / 画面比例 / 视频时长校验（含参考视频时的时长上限）
- 异步 generation API（创建、查询、取消、重试、转存）
- 付费双门闩：`ALLOW_PAID_GENERATION` + 请求体 `confirmPaidGeneration`
- **阶段 3A 已完成**：
  - Mock 使用本地合法 MP4（默认 `data/mock/mock-video.mp4`，或 `MOCK_VIDEO_FILE`）
  - **彻底移除**硬编码 98 B `MINIMAL_MP4` 写入与 `writeMockMp4` 伪视频逻辑
  - 缺失 / 无效 Mock 源 → 任务 `failed`（`MOCK_VIDEO_NOT_CONFIGURED` / `MOCK_VIDEO_INVALID`），不伪装 `completed`，不回退 PNG
  - `generatedVideo` 真实 `<video>` 播放（`VideoResultPlayer` / `VideoResultDrawer`）
  - assetId 内容路由支持 HTTP Range（200 / 206，Buffer 读取，禁止客户端传磁盘路径）
  - 浏览器 `loadedmetadata` 读取宽高时长，并 `PATCH .../metadata` 写回 `actual*` + `metadataSource`
  - 转存完整性：HTTP 状态、Content-Type、Content-Length、临时/最终文件大小、SHA-256；截断 → `resultTransferFailed`
  - 人工浏览器播放验收已通过（合法 Mock MP4、可播、可下载、Mock 标记、无真实阿里云调用）
- `generatedVideo` 类型的 `AssetRecord`
- GenerationRecord 上的 requested / provider / actual 字段与 `compare-params`
- 自动化测试：见 `src/video-generation/__tests__/`（数量以本文件「当前验证结果」为准）

---

# 98 B 伪 MP4 根因与修复

**根因（已修复）：**

- Mock 曾硬编码约 **98 B** 的 `MINIMAL_MP4`（残缺 `ftyp` / `moov` / `mdat` 字符串）
- 只有基础 box，**没有可解码视频轨道和媒体帧**
- 浏览器无法 `loadedmetadata`，界面表现为一直「正在读取视频…」

**当前行为：**

- `MockVideoProvider` 读取本地合法 MP4：默认 `data/mock/mock-video.mp4`，可用环境变量 `MOCK_VIDEO_FILE` 覆盖
- Mock 视频文件 **不进入 Git**（见 `.gitignore` 与 `docs/mock-video-setup.md`）
- 源缺失 → `MOCK_VIDEO_NOT_CONFIGURED` → `failed`
- 源无效 → `MOCK_VIDEO_INVALID` → `failed`
- **不会**再写出 98 B 占位文件，**不会**回退 PNG 伪装 `completed`

---

# 视频生成调用链

主路径（镜头节点选中后的提示栏）：

1. **`VideoPromptPanel`**：用户填写提示词与参数 → 打开确认抽屉 → 提交。
2. **`POST /api/generations`**：从工作流构建输入 → `submitVideoGeneration`。
3. **`VideoProvider`**：默认 `MockVideoProvider`；仅当环境配置为 `aliyun-wan27` 且通过付费门闩时走万相。
4. **Provider task** → `GenerationRecord.providerTaskId`。
5. **Polling**：`GET /api/generations/[generationId]` → `refreshGenerationStatus`。
6. **`transferRemoteVideoToLocal`**：下载 / 复制 → 完整性校验 → 登记 `generatedVideo` 资产。
7. **结果 UI**：`VideoShotNode` 封面预览 + 播放按钮 → `VideoResultDrawer` / `VideoResultPlayer`（原生 `controls`）；`generatedVideo` **不再**交给 `AssetThumb` / `ImageLightbox`。
8. **Metadata**：浏览器 `loadedmetadata` → 可选 `PATCH /api/generations/[id]/metadata`（仅 `actualWidth` / `actualHeight` / `actualDurationSeconds` / `metadataSource` / `updatedAt`）；失败不影响播放。

相关源码锚点：

- Mock 源校验：`src/video-generation/validate-mock-video-source.ts`
- 播放 / Range：`src/video-generation/serve-generated-video.ts`、`src/app/api/assets/[assetId]/route.ts`
- 播放器：`src/workflow/components/VideoResultPlayer.tsx`、`VideoResultDrawer.tsx`
- 配置说明：`docs/mock-video-setup.md`
- 旧同步接口 `POST /api/generate/video-shot` **已停用并抛错**，不得再走演示 PNG 冒充视频。

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

阶段 3A 最终安全验收（提交前本地跑通；提交后请把 commit hash 同步到「项目概况」）：

| 命令 | 结果 |
|------|------|
| `npm run lint` | 通过（退出码 0） |
| `npx eslint . --max-warnings=0` | 通过（退出码 0；error 0 / warning 0） |
| `npm run typecheck` | 通过（退出码 0） |
| `npm test` | 通过；**54** 项 |
| `npm run build` | 通过（退出码 0） |

安全配置：默认 mock、默认禁止付费；验收未进行真实付费生成、未 push。

人工验收（用户确认）：

- 已使用合法 `data/mock/mock-video.mp4` 创建全新 Mock 任务并成功生成
- 浏览器可播放；可读取时长与实际宽高；metadata PATCH 已执行
- 视频内容接口正常；下载 MP4 可被本机播放器打开
- 页面明确标记 Mock 演示；无阿里云真实接口 / 付费请求
- 不再生成 98 B 伪 MP4

---

# 当前已知状态

- **阶段 3A 已完成并提交**（本文件随提交更新）。
- Mock 播放依赖本地合法 MP4；文件不进 Git。
- `actualWidth` / `actualHeight` / `actualDurationSeconds` 经浏览器写回（`metadataSource: "browser"`）；不上报失败不影响播放。
- 相同 fingerprint 不重复上报；资产不匹配的迟到请求不能覆盖新视频。
- `compare-params` 已存在；完整三组参数对照 UI 为下一阶段。
- `selectedReferenceAssetIds` 超过 5 个参考素材时的手动勾选 UI 尚未实现。

---

# 尚未完成的功能

按建议顺序：

1. requested / provider / actual 参数对照展示（阶段 3B 建议方向）
2. 超过 5 个参考素材时的手动选择（并与校验/resolver 对齐）
3. 真实万相最低成本人工付费测试（可选；禁止 Agent 自动执行）

---

# 下一阶段

**名称：** requested / provider / actual 参数对照展示

**预计涉及（只描述，本交接不实现）：**

- 在结果 Drawer / 镜头面板清晰展示三组参数，禁止用 requested 冒充 actual
- 复用并完善 `compare-params` 与 GenerationRecord 字段
- 必要时补充单元测试与文案

约束延续：默认 mock、禁止自动付费、不 push、不 eslint-disable、不用 `any` / `@ts-ignore`、不开发阶段内未授权的真实 Provider 调用。

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
- `docs/mock-video-setup.md` — 本地 Mock MP4 配置与验收要点（仅开发环境）
- `docs/video-provider-aliyun-wan27.md` — 万相 2.7 Provider 配置与人工付费步骤
- `.env.example` — 环境变量模板（无密钥）
- `AGENTS.md` / `CLAUDE.md` — Next.js 版本注意

---

*文档对应阶段 3A 完成态。若后续功能提交改变行为，请同步更新本文件。*
