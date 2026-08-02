# 分镜视频 / 方舟参考图预检 — 交接单

> 用途：本对话上下文已过重，**请在新对话中打开本文件优先阅读**，再继续改代码或排障。  
> 日期：2026-07-31  
> 分支：`feat/react-flow-migration`（工作区 Dirty，勿回退无关改动）  
> 相关 Transcript：[`fcc46b3e-4279-4f10-a925-3e966c7f447d`](../../.cursor/projects/c-Users-Downloads-24-infinite-canvas/agent-transcripts/fcc46b3e-4279-4f10-a925-3e966c7f447d)

---

## 1. 当前产品目标（本批）

1. 分镜「生成本镜头视频」能稳定打通火山方舟 Seedance。  
2. **真人参考图**导致的审核废单要降成本：提交前廉价预检 + 自动去掉高风险人物参考。  
3. 失败原因对用户可读（中文提示）。

---

## 2. 已确认事实（不要再当未知 bug）

| 现象 | 根因 | 状态 |
|------|------|------|
| `duration … not valid … r2v` | Seedance 参考生视频时长需约 4–15s；镜头 3s 非法 | 已钳制到能力范围 |
| `image_url … not valid` | 相对路径/本地图未变成方舟可读 URL/data URL | 已修 asset-resolver |
| 模型 ID 无效 / 404 | 展示名未归一成正式 model id | 已有 `normalizeArkVideoModelId`；配置用 `doubao-seedance-2-0-260128` |
| **`may contain real person` / 内容审核未通过** | 人物「江宸」等**写实剧照级**参考图被 Seedance 输入审核拒绝 | **平台策略**，非链路断；已做预检+自动 omit |
| 视频「还是无法生成」 | 最新失败记录仍是真人审核（已中文化） | 换插画设定图，或接受跳过人物参考只带场景 |

复现项目：`p_6f698d95cf83`，镜头 `shot_fd0ce838bb`，人物资产江宸。  
最新 generation 示例目录：`data/generations/*.json`（`errorCode: HTTP_VIDEO_PROVIDER_ERROR`）。

---

## 3. 本批已落地的代码能力

### 3.1 错误可读化

- [`src/video-generation/user-facing-error.ts`](../src/video-generation/user-facing-error.ts)  
  - `classifyVideoProviderError` / `formatVideoProviderErrorForUser` / `isRealPersonModerationError`
- UI：[`ShotVideoPreview.tsx`](../src/projects/storyboard/components/ShotVideoPreview.tsx)、[`StoryboardShotAccordion.tsx`](../src/projects/storyboard/components/StoryboardShotAccordion.tsx)（失败 note 用 `is-error`）

### 3.2 Seedance 真人失败兜底

- [`submitStoryboardShotVideo`](../src/projects/storyboard/services/storyboard-video-generate.ts)  
  - 创建失败若为真人审核 → `omitCharacterReferencesFromInput` 后换幂等键重试  
  - 返回 `notice` 给前端

### 3.3 火山侧图片预校验（降废单成本）

**核心模块**：[`src/video-generation/ark-image-safety-precheck.ts`](../src/video-generation/ark-image-safety-precheck.ts)

- 方舟 Chat Completions 多模态；输出 `ok | likely_real_person | other_risk | check_failed`
- 凭证：优先管理 API 槽位 `video-ref-precheck`；否则复用 `video-shot` 的方舟 URL+Key  
- 默认 vision 模型：`doubao-seed-2-0-lite-260215`（可用 `VIDEO_REF_PRECHECK_MODEL` / 管理 API 覆盖；须账号已开通该 VLM）

**资产字段**：`videoRefSafety`（character/scene/prop）  
- 类型：[`src/projects/assets/types.ts`](../src/projects/assets/types.ts)  
- 换图清空：[`patchImageableAssetImageMeta`](../src/projects/assets/asset-image-storage.ts)

**触发点**

| 时机 | 位置 |
|------|------|
| 上传图片成功 | `assets-draft/images/[assetId]` PUT |
| 审批入库 promote | `approvals/promote.ts`（异步 fire-and-forget） |
| 视频提交前 | `ensureShotVideoRefPrechecks` → 人物 `likely_real_person` 则先 omit 再提交 |

**UI**

- 素材卡角标：[`ShotAssetCard.tsx`](../src/projects/storyboard/components/ShotAssetCard.tsx)  
- 确认弹窗：`charactersSkippedForRealPerson`（[`VideoGenerationConfirmationDialog.tsx`](../src/projects/storyboard/components/VideoGenerationConfirmationDialog.tsx)）

**能力/配置**

- Capability：`video.reference-image.precheck`  
- Profile slot：`video-ref-precheck`（[`api-config.ts`](../src/auth/api-config.ts)、[`capabilities.ts`](../src/ai-config/capabilities.ts)）

**测试**

- `src/video-generation/__tests__/ark-image-safety-precheck.test.ts`  
- `src/projects/assets/__tests__/video-ref-safety-clear.test.ts`  
- `src/projects/storyboard/__tests__/storyboard-video-moderation-retry.test.ts`  
- `src/video-generation/__tests__/user-facing-error.test.ts`

### 3.4 其它相关（同会话更早）

- 角色音色：软提醒、不硬拦视频  
- 提示词 `@` 提及与芯片删除  
- 幂等键失败后轮换，避免卡死重试

---

## 4. 用户如何「进行校验」（操作说明）

1. **配置**：管理 API →「视频参考图预检」填方舟 Base URL + Key + 图片理解模型；或仅保证「视频镜头」方舟已通。  
2. **触发**：上传/换图后自动预检；点「生成本镜头视频」前会补检。  
3. **看结果**：素材角标「疑似真人」；确认弹窗列出将跳过人物；不必手点单独校验按钮。  
4. **预检未配置**：记 `check_failed`，不阻断；仍靠 Seedance 失败后 omit 兜底。

---

## 5. 明确边界

- 预检是**廉价近似**，不能 100% 等同 Seedance 创建审核。  
- 真要用人像参考：需火山**私域真人人像认证资产**（本批未做）。  
- 资产生成提示词里仍有「真人电影级」导向（[`generate-design-asset-image.ts`](../src/projects/assets/episode-design/generate-design-asset-image.ts)），容易产出 Seedance 不吃的图——若产品要「生成即视频可用」，可能需后续改生图风格文案。

---

## 6. 2026-07-31 验证结果（本对话）

| 项 | 结果 |
|----|------|
| `video-shot` 方舟 Key/URL | 可用（Seedance 历史任务已能打到方舟） |
| 独立槽位 `video-ref-precheck` | **已写入** `data/generation-api-configs.json`：复用方舟 URL+Key，模型 `doubao-seed-2-0-lite-260215` |
| 旧默认 `doubao-1-5-vision-pro-32k-250115` | 本账号 **404 / 未开通**（目录里多为 Retiring） |
| 可用 VLM（实测） | `doubao-seed-2-0-lite-260215` / `doubao-seed-2-0-pro-260215` / `doubao-seed-2-0-lite-260428` 已开通 |
| 江宸 `gen_c1fd557d822f435a` 预检 | **`likely_real_person`**（写实人脸）已写入 `videoRefSafety` |
| 场景「诡市第九号当铺人事办公室」 | **`ok`** |
| `shot_fd0ce838bb` 提交前 omit | **会跳过江宸**，人物参考 1→0，保留场景图；notice 文案就绪 |
| Seedance 实提交 | **本轮未跑**（避免再烧视频费）；仍靠预检 omit + 失败后 omit 兜底 |

代码修正：

- 默认 vision 模型改为 `doubao-seed-2-0-lite-260215`
- `resolveArkVisionPrecheckRuntime`：优先读 `video-shot` profile，缺钥/抛错时降级 mock，不再把整条预检打崩
- 预检 HTTP 失败原因带上「未开通 / 模型不可用」中文指引

---

## 7. 建议后续任务（按需选）

1. UI 确认：分镜页素材角标「疑似真人」+ 确认弹窗列出江宸；可选手点一次「生成本镜头视频」看 notice（会调 Seedance，计费）。  
2. **改生图风格默认**：人物设计图从「真人电影级」改为「插画/设定图」，从源头减少真人审核。  
3. **DesignAssetModal 生成成功后立刻预检**（当前主要在上传/promote/视频提交）。  
4. **私域真人资产**（大需求，另开批次）。  
5. 勿提交 `.env` / 密钥；提交代码前按用户明确要求再 commit。

---

## 8. 新对话启动提示（可复制）

```
请先阅读 docs/STORYBOARD_VIDEO_ARK_PRECHECK_HANDOFF.md（含 2026-07-31 验证结果），
以当前工作区代码为准继续（分支 feat/react-flow-migration，Dirty 勿回退）。
预检已通：video-ref-precheck + doubao-seed-2-0-lite-260215；江宸已标 likely_real_person。
可选：UI 看角标/确认弹窗，或改生图风格默认减少真人废单。
```

---

## 9. 关键入口速查

| 页面 | URL 形态 |
|------|----------|
| 分镜 | `/app/workspace/projects/{projectId}/storyboard` |
| 管理 API | 应用内管理员「管理 API」面板 |
| 失败 generation | `data/generations/{id}.json` |
