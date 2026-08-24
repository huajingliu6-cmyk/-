# InfiniteCanvas 迭代交接单

> 生成时间：2026-08-24  
> 分支：`feat/react-flow-migration`  
> 最近提交：`1fed45f` — `feat: overhaul asset library, extraction, and workspace sync`  
> **工作区有大量未提交改动（约 100+ 文件），尚未 commit**

---

## 1. 给新 Agent 的一句话指令

> 阅读本文件；确认 Docker Desktop 已运行；执行 `.\deploy\start-lan.ps1 -ForceRecreate` 重建 web；`.\deploy\check-lan.ps1` 通过后验收。优先处理：**AI 生图多参考图只能上传一张**（见 §6）。其次验收资产库「+」新建占位、单集资产提取名单选择流程。

---

## 2. 本轮会话已完成（工作区改动，未提交）

### 2.1 资产库「+」按钮 → 新建占位（人物/场景/道具）

**问题**：点击造型/编辑区「+」会触发保存，而非新建空占位。

**已改**：

| 模块 | 文件 | 改动 |
|------|------|------|
| 人物造型 | `CharacterDetail.tsx` | `openCreateLookEditor` 移除 `onSave?.()`；新建 appearance 时 `promptOverride: ""`、`currentMediaId: null`；跳转到最后分页；`previewId: null`；`runWithPromptGuard` 包裹 onClick |
| 人物提示词 | `CharacterDetail.tsx` | `appearancePromptScopeText`：无 `currentMediaId` 的编辑中造型不 fallback 到 `buildLookPromptPrefill`，右侧提示词为空 |
| 场景 | `SceneDetail.tsx` | `addDraftVariant` 移除立即 `onPersist`；`setHeroMediaId(null)`、`setLightboxMediaId(null)` |
| 道具 | `PropDetail.tsx` | 同场景 |
| 测试 | `character-history-look-ui.test.ts` | 断言 `openCreateLookEditor` 不含 `onSave`；空提示词逻辑 |

### 2.2 单集资产提取 → 名单选择再设计

**期望流程**：
1. 点击「提取本集资产」→ 扫描剧本发现资产名单
2. 展示名单卡片，用户勾选要设计的资产
3. 确认后后台与模型进行资产设计对话（`extracting_details`）
4. 结果写入人物/场景/道具列表

**已改/新增**：

| 文件 | 职责 |
|------|------|
| `extraction/types.ts` | 新增 `awaiting_roster_selection` 状态与 progress phase |
| `extraction/run-task.ts` | roster 发现完成后进入 `awaiting_roster_selection` 暂停 |
| `extraction/confirm-roster.ts` | **新增** 用户确认选择后启动 detail 提取 |
| `extraction/http.ts` | 接入 confirm roster API |
| `extraction/public-task.ts` | 对外暴露 roster 供前端展示 |
| `extraction/progress-view.ts` | 修复 TS：`awaiting_roster_selection` 映射到 stage；补充文案 |
| `extraction/store.ts` | 持久化新状态 |

**构建修复**：`confirm-roster.ts` 中 `nextTask` 类型收窄为 `never` 的问题已改为 `confirmedTask: AssetExtractionTask | undefined`。

### 2.3 一栈式 Flow 导航

| 改动 | 文件 |
|------|------|
| 进入一栈式后隐藏顶栏 | `nav.ts` `isOneStackFlowPath()` + `AuthenticatedAppShell.tsx` |
| 移除「素材引擎」导航 | `space-navigation.ts` |
| 重命名「一栈式Flow」 | `projects/page.tsx`、`ProjectStageNav.tsx` |
| 筛选：全部 / 进行中 / 已完成 | `projects/page.tsx`（进行中 = draft + generating） |
| 侧边栏与入口 | `AppSidebar.tsx`、`use-open-one-stack-flow.tsx` 等 |

### 2.4 个人中心（AI 生图 / 生视频）

**新增模块** `src/personal/`：

| 路径 | 职责 |
|------|------|
| `ui/PersonalHubShell.tsx` | 个人中心壳（生图/生视频 Tab） |
| `ui/PersonalImageWorkspace.tsx` | AI 生图工作区 |
| `ui/PersonalImageReferenceStrip.tsx` | 参考图条（最多 6 张，`multiple` file input） |
| `ui/PersonalVideoWorkspace.tsx` | AI 生视频工作区 |
| `ui/PersonalVideoHistoryThumb.tsx` | 视频历史缩略图（poster 修复） |
| `image-generation/` | 生图 API、store、constants |
| `video-generation/` | 生视频 API、SD2 人物检验、poster-url |

**API 路由**：`src/app/api/personal/image-generations/`、`video-generations/`

**其他修复**：
- 视频历史封面：`poster-url.ts` 区分视频 URL 与图片 poster
- 视频下载按钮叠加在预览/历史卡片上
- 个人视频人物检验改用 SD2 路由：`sd2-image-video-ref-precheck.ts`（与资产设计一致，非 Ark vision）

### 2.5 个人素材 & 素材市场

**新增模块**：

| 路径 | 职责 |
|------|------|
| `src/personal-assets/` | 个人素材库（上传、列表、批量删除） |
| `src/asset-market/` | 素材市场（浏览、预览、加入个人/项目/画布） |
| `src/app/api/personal-assets/` | 个人素材 API |
| `src/app/api/asset-market/` | 素材市场 API |
| `src/auth/market-assets-permissions.ts` | 市场权限 |

### 2.6 材料库调整

`src/materials/` 多处改动：引用、个人素材选择器、catalog/citation store、API routes。

### 2.7 LAN 部署

- 2026-08-24 重建 web 成功（修复 TS 后 `LAN start complete`）
- 首次失败原因：Docker Desktop 未启动
- 第二次失败：`confirm-roster.ts`、`progress-view.ts` TS 错误
- 第三次成功

```powershell
cd E:\DevWorkspace\projects\InfiniteCanvas\code\infinite-canvas
# 确认 Docker Desktop 已运行
.\deploy\start-lan.ps1 -ForceRecreate
.\deploy\check-lan.ps1
```

| 项 | 值 |
|----|-----|
| 端口 | `3080`（`.env.lan` 中 `WEB_PORT`） |
| 访问 | `http://<本机LAN IP>:3080/`（`check-lan.ps1` 会打印） |
| build-revision | `1fed45f-dirty`（含未提交改动） |

---

## 3. 待处理 / 已知问题（优先级排序）

### P0 — AI 生图只能上传一张参考图

**用户反馈**：界面显示 `1/6`，但实际只能上传一张参考图。

**已有代码**（逻辑上应支持多张）：
- `PersonalImageReferenceStrip.tsx`：`multiple` file input + add 按钮
- `personal-image-utils.ts`：`mergeReferenceFiles()` 合并到 max 6
- `PersonalImageWorkspace.tsx`：`form.append("image", reference.file)` 循环 append
- `generate-personal-image.ts`：`form.getAll("image")` 读取多张

**排查方向**：
1. 确认 LAN 镜像是否为最新（硬刷新 Ctrl+F5）
2. 检查 CSS：`.personal-image-reference-slot--add` 是否被遮挡或不可点击
3. 检查第二次点击 file input 是否触发 `onChange`（`event.target.value = ""` 重置）
4. 检查是否有其他地方（如 toolbar）还有旧的单图上传逻辑覆盖
5. 浏览器端：Windows 文件选择器是否只选了一张（`multiple` 属性是否生效）
6. 运行测试：`npx vitest run src/personal/__tests__/personal-image-upload.test.ts`

### P1 — 单集资产提取 UI 接线

后端 `awaiting_roster_selection` + `confirm-roster.ts` 已就绪，需确认前端：
- `AssetManagementWorkspace.tsx` / `EpisodeAssetDesignWorkspace.tsx` 是否展示 roster 选择卡片
- 用户勾选后是否调用 confirm API
- 设计对话完成后是否正确入库

### P2 — 提交未 commit 的改动

用户曾要求「提交最近所有改动」，后台 agent 可能未完成。当前 `git status` 仍有大量 M/?? 文件。

**勿提交**：`tmp/`、`deploy/web-rebuild.log`、`deploy/web-up.log`、`.env.lan`

### P3 — 预存测试失败

```
workspace-permission-routes.test.ts — 期望 workspaceProjectAssetsDesignPath，实际 redirect 到 libraryPath
route-wiring.test.ts — workflow-forbidden 字符串不匹配
asset-library-split-layout.test.ts — CSS max-height 期望值过时
```

---

## 4. 关键文件地图

### 资产库 UI

| 文件 | 职责 |
|------|------|
| `CharacterDetail.tsx` | 人物：主形象 + 造型 board + 历史 + lightbox |
| `SceneDetail.tsx` | 场景：预览 + 场景编辑 board |
| `PropDetail.tsx` | 道具：预览 + 道具编辑 board |
| `LibraryAssetMediaGrid.tsx` | 场景/道具编辑区 grid |
| `CompactPromptReferenceSlots.tsx` | 资产设计 3 槽参考图 |
| `AssetManagementWorkspace.tsx` | 三 Tab 工作台 + 提取工具栏 |
| `EpisodeAssetDesignWorkspace.tsx` | 单集资产设计大工作区 |
| `AssetExtractionToolbar.tsx` | 「提取本集资产」按钮 |

### 资产提取 pipeline

| 文件 | 职责 |
|------|------|
| `extraction/run-task.ts` | 提取任务主流程 |
| `extraction/confirm-roster.ts` | 用户确认名单 → 启动 detail 提取 |
| `extraction/types.ts` | 状态机类型 |
| `extraction/store.ts` | 持久化 |
| `extraction/progress-view.ts` | 进度 UI 文案 |
| `extraction/http.ts` | HTTP 路由处理 |

### 个人中心

| 文件 | 职责 |
|------|------|
| `personal/ui/PersonalHubShell.tsx` | 壳 |
| `personal/ui/PersonalImageWorkspace.tsx` | 生图 |
| `personal/ui/PersonalImageReferenceStrip.tsx` | 参考图条 |
| `personal/ui/PersonalVideoWorkspace.tsx` | 生视频 |
| `personal/image-generation/generate-personal-image.ts` | 生图服务端 |
| `personal/video-generation/precheck-reference.ts` | SD2 人物检验 |

### Shell / 导航

| 文件 | 职责 |
|------|------|
| `shell/AuthenticatedAppShell.tsx` | 顶栏 / 侧边栏切换 |
| `shell/AppSidebar.tsx` | 侧边栏（AI 生图/生视频/个人素材/素材市场/画布） |
| `shell/nav.ts` | `isOneStackFlowPath()` |
| `shell/space-navigation.ts` | 空间导航项 |
| `shell/use-open-one-stack-flow.tsx` | 一栈式 Flow 入口 |

### 部署

| 文件 | 职责 |
|------|------|
| `deploy/start-lan.ps1` | 构建 web + 启动 gateway |
| `deploy/check-lan.ps1` | 健康检查 |
| `deploy/compose.lan.override.yml` | LAN 覆盖 |
| `deploy/.env.lan` | 环境变量（**勿提交**） |

---

## 5. 布局与交互约定

### 资产库提示词面板（人物/场景/道具）

1. 参考图 3 槽位（拖拽、个人素材、本地上传）
2. 提示词标签 +「复制提示词」
3. 文本编辑区
4. 底部：生成参数 / 生成资产

### 资产库「+」按钮（人物造型 / 场景编辑 / 道具编辑）

- 点击「+」→ 新建空编辑占位（「编辑中」）
- 右侧提示词清空，等待用户填写新生成提示词
- **不触发保存**

### 个人中心 AI 生图

- 提示词 textarea 上方/下方：`PersonalImageReferenceStrip`（最多 6 张参考图）
- 工具栏：比例 / 画质 / 模型 / 张数 +「开始生成」
- 支持粘贴图片、拖拽到 prompt 区域

### 单集资产提取

1. 选剧集 → 点「提取本集资产」
2. 扫描 → 展示资产名单卡片（`awaiting_roster_selection`）
3. 用户勾选 → 确认
4. 后台设计对话 → 写入各资产列表

---

## 6. 常用命令

```powershell
# PowerShell 勿用 &&，用 ;
Set-Location E:\DevWorkspace\projects\InfiniteCanvas\code\infinite-canvas

# 重建 web（需 Docker Desktop 运行）
.\deploy\start-lan.ps1 -ForceRecreate

# 严格重建（无缓存）
.\deploy\start-lan.ps1 -Strict

# 仅重启（不重建镜像）
.\deploy\start-lan.ps1 -ForceRecreate -SkipBuild

# 健康检查
.\deploy\check-lan.ps1

# 测试
npx vitest run src/projects/assets/__tests__/character-history-look-ui.test.ts
npx vitest run src/personal/__tests__/personal-image-upload.test.ts
npx vitest run src/personal/__tests__/personal-image-hub.test.ts
npx vitest run src/shell/__tests__/one-stack-flow-entry.test.ts
```

---

## 7. Git 状态摘要

```
HEAD: 1fed45f feat: overhaul asset library, extraction, and workspace sync
工作区: ~47 modified + ~30+ untracked（personal/, personal-assets/, asset-market/, confirm-roster.ts 等）
未提交: 用户曾要求 commit，可能未完成
```

**建议 commit 范围**：排除 `tmp/`、`deploy/*.log`、`.env.lan`，包含其余功能改动。

---

## 8. 验收清单

- [ ] LAN `check-lan.ps1` 通过，浏览器硬刷新
- [ ] 人物/场景/道具「+」新建占位 + 空提示词，不保存
- [ ] 一栈式 Flow：顶栏隐藏、项目列表筛选、名称正确
- [ ] 单集资产提取：名单卡片 → 选择 → 设计 → 入库
- [ ] AI 生图：可上传多张参考图（最多 6）
- [ ] AI 生视频：历史封面圆角、下载按钮叠加、SD2 人物检验
- [ ] 个人素材 / 素材市场基本浏览

---

*交接单路径：`deploy/HANDOVER.md`*
