# 交接单：任务规则 / 资产生成 / 人物校验 / 移动 SD2 视频线路

> **用途**：本对话上下文已过重。请在**新 Agent 对话**中优先打开本文件，再改代码或排障。  
> **日期**：2026-07-31  
> **分支**：`feat/react-flow-migration`（工作区 Dirty，**严禁**回退或清理无关改动）  
> **相关 Transcript**：[`fcc46b3e-4279-4f10-a925-3e966c7f447d`](../../.cursor/projects/c-Users-Downloads-24-infinite-canvas/agent-transcripts/fcc46b3e-4279-4f10-a925-3e966c7f447d)  
> **前置交接**（视频方舟预检，勿重复当未知）：[`STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md`](./STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md)  
> **平台客户文档（桌面，只读参考）**：`C:\Users\江城的助手\Desktop\Seedance2.0API接口文档.md`（移动 SD2 平台）

---

## 0. 新对话开场建议（复制给 Agent）

```text
先读 docs/SD2_TASK_RULES_AND_DESIGN_PRECHECK_HANDOFF.md
再读 docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md
分支 feat/react-flow-migration，Dirty 勿回退。
按交接单「未完成 / 建议下一步」继续；不要重复已确认事实。
```

---

## 1. 本批产品目标（已做 + 未完）

| # | 目标 | 状态 |
|---|------|------|
| A | 管理端「功能绑定与任务规则」可正常保存草稿/发布 | ✅ 已修 UX |
| B | 文生图（设计素材 / 角色 / 场景）使用**已发布**任务规则 | ✅ 已接入 |
| C | 设计素材弹窗「人物校验」防视频真人拒审 | ✅ 已接预检 UI+API |
| D | 按移动 SD2 文档做视频线路：普通素材 vs 真人认证素材 | ✅ 方言 `sd2` 已落地 |
| E | 开发机 `localhost:3000` 连接被拒 | ✅ `0.0.0.0` 绑定 |
| F | SD2 端到端真机联调（真实平台 URL+Key） | ⏳ **未在本机真跑通**，需用户配置后验 |
| G | 设计素材生成图 → 入库后库资产 `videoRefSafety` 同步 | ✅ promote 携带；**入库后再校验**也会回写管理库+工作台本地（`syncDesignVideoRefSafetyToLibrary`） |
| H | SD2 认证失败 UX（failed/blocked/超时） | ✅ 中文阻断 + 勿 omit 重试 + 确认弹窗分流 |

---

## 2. 已确认事实（不要再当未知 bug）

1. **任务规则草稿保存「看起来失败」**：后端 `PUT …/draft` 本就可用；问题是保存后 `hasDraft` 刷新滞后、提示在面板顶部、发布不自动落盘编辑器内容。已修。  
2. **图片不跟管理端规则**：以前文生图只绑模型，**从不调用** `getEffectivePublishedRule`；`assembleImageStylePrompt` 是死代码。硬编码「真人电影级 / 禁止定妆表」还会和已发布「三视图定妆表」规则打架。已修。  
3. **运行时只用「已发布」规则**，草稿不进线上（与文本能力一致）。  
4. **方舟直连**拒真人参考图 → 预检 `likely_real_person` + 提交前 omit 人物参考。  
5. **移动 SD2 平台**规则不同：真人素材走 `/api/real-person-assets/*`，等 `certifications[].status === active`，再用 `asset://` 创建 `/v1/video/generations`；**不应**在 SD2 线路上 omit 人物。  
6. **`ERR_CONNECTION_REFUSED` on :3000**：曾因 `next dev -H localhost` 只听 `[::1]`，IPv4 `127.0.0.1` 被拒。`package.json` 已改为 `-H 0.0.0.0`。  
7. **密钥隐私**：用户仅在本对话暴露过 Key；其他用户的 AI **不能**通过提问拿到。勿把完整 Key 再贴进聊天。配置落本地 `data/`（gitignore）+ 尽量加密；前端只见脱敏。

复现项目（历史）：`p_6f698d95cf83`；设计素材角色「江辰 / 江宸」写实图易触发真人预检。

---

## 3. 本批已落地代码（按主题）

### 3.1 开发服务监听

- [`package.json`](../package.json)：`dev` / `dev:local-paid-test` → `next dev --webpack -H 0.0.0.0 -p 3000`

### 3.2 管理端任务规则保存 UX

- [`CapabilityRulesTab.tsx`](../src/auth/ai-admin/CapabilityRulesTab.tsx)：静默刷新摘要  
- [`CapabilityRuleCard.tsx`](../src/auth/ai-admin/CapabilityRuleCard.tsx)：卡片内成功/失败提示、本地 `hasDraft`、发布前自动存草稿、revision 冲突重载  

### 3.3 文生图注入已发布任务规则

- [`prompt-assembly.ts`](../src/ai-config/prompt-assembly.ts)：`buildAssembledImagePrompt` + `DEFAULT_IMAGE_PLATFORM_RULE`  
- 接入点：  
  - [`generate-design-asset-image.ts`](../src/projects/assets/episode-design/generate-design-asset-image.ts)  
  - [`character-generation.ts`](../src/workflow/lib/character-generation.ts)（appearance）  
  - [`scene-generation.ts`](../src/workflow/lib/scene-generation.ts)  
- 平台层只锁 16:9/4K；风格由管理员已发布规则决定  
- 测试：`design-asset-image.test.ts`

### 3.4 设计素材「人物校验」（移动 SD2 真人认证上传）

- **权威**：点「人物校验」→ `materializeSd2AssetRef(realPerson=true)` → 轮询至 `active` / `failed` / `blocked`
- 映射：`active`→`ok`（绿盾锁定，不可再校）；`failed`/`blocked`→`likely_real_person`；超时/配置→`check_failed`
- 模块：[`design-media-video-ref-precheck.ts`](../src/projects/assets/episode-design/design-media-video-ref-precheck.ts)
- 手动：`…/items/[itemId]/video-ref-precheck`（management + workspace）；已 `ok` 则短路不重传
- UI：[`DesignAssetModal.tsx`](../src/projects/assets/DesignAssetModal.tsx) 绿盾 `is-verified` + 警告条
- **生成后不再自动校验**（避免每次生图阻塞等 SD 认证）
- 方舟 VLM 预检仍用于**库资产上传/promote/分镜 omit**（勿与设计人物校验混用）
- 测试：`design-media-video-ref-precheck.test.ts`

### 3.4b（历史）方舟 VLM 预检（库资产 / 分镜）

- 核心：[`ark-image-safety-precheck.ts`](../src/video-generation/ark-image-safety-precheck.ts)
  - `runVideoRefPrecheckForImageFile` 仍可供非 SD 场景复用，**设计人物校验已不再调用**
- 设计侧标签：[`design-media-video-ref-labels.ts`](../src/projects/assets/episode-design/design-media-video-ref-labels.ts)
- `GeneratedMediaState.videoRefSafety` / history 条目可存预检结果
- 文案：去掉「真人电影级」引导；种子提示改为插画/设定图（[`format-design-draft-seed.ts`](../src/projects/assets/episode-design/format-design-draft-seed.ts)）

### 3.5 移动 SD2 视频方言（新）

| 模块 | 路径 |
|------|------|
| 方言检测 / URL | [`http-video-dialect.ts`](../src/video-generation/provider/http-video-dialect.ts) → `HttpVideoDialect` 含 **`sd2`** |
| 上传 + 真人认证轮询 | [`sd2-platform-client.ts`](../src/video-generation/provider/sd2-platform-client.ts) |
| 提交 / 轮询 | [`http-video-provider.ts`](../src/video-generation/provider/http-video-provider.ts) → `submitSd2` / `pollSd2` |
| 素材分流标记 | [`ResolvedProviderMedia.realPersonCandidate`](../src/video-generation/types.ts)；[`asset-resolver.ts`](../src/video-generation/asset-resolver.ts) |
| 提交前 omit 策略 | [`storyboard-video-generate.ts`](../src/projects/storyboard/services/storyboard-video-generate.ts)：检测到 SD2 **不 omit** 人物，改为认证线路提示 |
| 管理 API 文案 | [`api-config.ts`](../src/auth/api-config.ts) `video-shot` / `video-ref-precheck` |
| 环境变量说明 | [`.env.example`](../.env.example) `VIDEO_SHOT_HTTP_DIALECT=sd2` |
| 测试 | `http-video-dialect.test.ts`、`sd2-http-video-provider.test.ts` |

**SD2 识别方式（任一）：**

1. Base URL 含 `/v1/video/generations` 或 `/api/real-person-assets`  
2. 或强制：`VIDEO_SHOT_HTTP_DIALECT=sd2`  
3. 模型名文档态：`doubao-seedance-2.0`（`DEFAULT_SD2_VIDEO_MODEL`）

**SD2 行为摘要：**

- 普通参考 → `POST {root}/api/assets/upload` → `asset://…`  
- 真人候选 → `POST {root}/api/real-person-assets/upload` → 轮询 `GET {root}/api/assets/{key}` 至 `active` / `failed` / `blocked`  
- 创建 → `POST {root}/v1/video/generations`，Header `Idempotency-Key: generationId`，content 用 `asset://`（不用 data URL）  
- 下载 → `GET {root}/v1/videos/{taskId}/content`（Bearer）

**方舟直连保持不变**：仍走 `/api/v3/contents/generations/tasks` + data/HTTPS URL。

---

## 4. 配置清单（给用户 / 新 Agent 联调）

### 移动 SD2 / VideoFee（审核门禁，可与方舟并存）

1. 管理 API →「移动 SD2 平台」：Base URL = `http://36.212.37.227:3099`（或运营给的地址）+ Key  
2. 或 `.env.local`：`SD2_PLATFORM_API_URL` + `SD2_PLATFORM_API_KEY`  
3. **视频镜头**可继续配方舟；人物参考图须先「人物校验」/提交时 SD 认证 `active` 后才进方舟生视频  
4. 普通场景/道具参考：按文档可不走真人认证  

### 方舟直连（旧）

- 管理 API → 视频镜头：`https://ark.cn-beijing.volces.com/api/v3` + Key + `doubao-seedance-2-0-260128`  
- 视频参考图预检：可复用同一 URL+Key，模型填已开通的 VLM（默认曾用 `doubao-seed-2-0-lite-260215`）

### 移动 SD2（新）

1. Provider = `http`  
2. Base URL = 运营给的平台根（或带 `/v1/video/generations`）  
3. Model = `doubao-seedance-2.0`  
4. 若根域名无法自动识别方言 → `.env.local`：`VIDEO_SHOT_HTTP_DIALECT=sd2`  
5. **勿**把完整 API Key 贴进 Agent 聊天；只写在管理 API / `.env.local`

---

## 5. 未完成 / 建议下一步（新对话优先）

1. **SD2 真机联调**：用真实平台 URL+Key 跑「上传普通 / 上传真人→active→创建视频→下载」全链路；对照桌面文档状态机。  
   - 含设计素材「人物校验」：点按钮 → SD `/api/real-person-assets/upload` → active 绿盾锁定 / failed|blocked 疑似真人。  
2. ~~**认证失败 UX**~~：✅ …  
3. ~~**设计生成图 ↔ 库资产预检**~~：✅ …  
4. **预检 Provider 与视频 Provider 分离**：方舟 VLM（`video-ref-precheck`）仍用于**库资产/分镜 omit**；设计「人物校验」走 **「管理 API → 移动 SD2 平台」**槽位（`sd2-platform` / `SD2_PLATFORM_API_*`），可与方舟 `video-shot` 并存。  
5. ~~**回归：方舟 omit vs SD2 不 omit**~~：✅ …  
6. **提交未提交的大量 Dirty**：勿盲目 `git add .`；按主题拆 commit（用户未要求则不要主动 commit）。

### 本轮（续作）落地摘要

| 项 | 说明 |
|----|------|
| SD2 认证错误 | `user-facing-error.ts` 新增 `certification` + `isSd2RealPersonCertError`；失败文案带素材 label |
| 提交策略 | `resolveRealPersonSubmitStrategy`；SD2 认证失败禁止 omit 重试 |
| 公开配置 | `PublicVideoConfig.usesSd2RealPersonCertification` → 确认弹窗分流 |
| promote 同步 | `resolveVideoRefSafetyFromDesignMedia` 入库即带角标 |
| **设计人物校验** | ✅ SD2/VideoFee 真人认证上传；`ok`=绿盾锁定；`failed/blocked`→疑似真人 |
| **校验→库同步** | ✅ `syncDesignVideoRefSafetyToLibrary`：设计校验后/已锁定短路时回写 `drafts/assets.json` + 工作台本地；修复入库后改校验分镜仍「疑似真人」 |
| **方舟+SD 门禁** | ✅ 配了「移动 SD2 平台」时：人物须 SD `active` 才进方舟；未完成阻断；认证失败 omit |
| **文档对齐** | ✅ 轮询含 `row.status`；任务态含 SUCCESS/FAILURE；sd2-platform 允许公网 http |

---

## 6. 关键命令

```powershell
cd C:\Users\江城的助手\Downloads\24\infinite-canvas
npm run dev
# 应监听 0.0.0.0:3000；127.0.0.1 与 localhost 均可

npx vitest run src/video-generation/__tests__/http-video-dialect.test.ts src/video-generation/__tests__/sd2-http-video-provider.test.ts src/video-generation/__tests__/user-facing-error.test.ts src/projects/assets/episode-design/__tests__/design-asset-image.test.ts src/projects/assets/episode-design/__tests__/design-media-video-ref-precheck.test.ts src/projects/storyboard/__tests__/storyboard-video-moderation-retry.test.ts src/projects/assets/approvals/__tests__/promote-video-ref-safety.test.ts
```

---
## 7. 刻意不要做的事

- 不要 invent 第二套视觉预检 Provider；继续复用 `video.reference-image.precheck` / `callArkVisionImagePrecheck`。  
- 不要把 SD2 折进 `legacy-sync` 或误伤 `/v1/videos`（openai-videos）方言。  
- 不要在客户响应/日志里回传上游 `provider_*` / `realPeopleAssetId`（文档禁止事项）。  
- 不要回退工作区无关 Dirty 成果。  
- 不要向用户复述或索要完整 API Key。

---

## 8. 文件速查表

| 主题 | 关键路径 |
|------|----------|
| SD2 方言 | `src/video-generation/provider/http-video-dialect.ts` |
| SD2 客户端 | `src/video-generation/provider/sd2-platform-client.ts` |
| HTTP Provider | `src/video-generation/provider/http-video-provider.ts` |
| 提交 omit 策略 | `src/projects/storyboard/services/storyboard-video-generate.ts` |
| 图片规则拼装 | `src/ai-config/prompt-assembly.ts` |
| 设计生成+预检 | `src/projects/assets/episode-design/generate-design-asset-image.ts`、`design-media-video-ref-*.ts`、`DesignAssetModal.tsx` |
| 管理规则 UI | `src/auth/ai-admin/CapabilityRuleCard.tsx` |
| 旧预检交接 | `docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md` |
