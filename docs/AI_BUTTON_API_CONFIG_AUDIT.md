# AI Button / API Config Audit

> Updated: **2026-07-29（H2-AI-CONTROL）**  
> Registry source of truth: `src/ai-config/capabilities.ts`  
> **完整基线：** `docs/CURRENT_PROJECT_MASTER_HANDOFF.md` + `docs/H1_CLOSE_HANDOFF_PATCH.md`  
> **H2 架构：** `docs/AI_TASK_RULES_ARCHITECTURE.md`  
> Scope: current workspace code. Classification is code-truth, not button-text alone.

---

## H2：自定义任务规则 + modelConnection 绑定

| 项 | 说明 |
|---|---|
| 模型接入 | 管理员在「模型接入配置」Tab 创建 `modelConnection`（mock/http/aliyun-wan27）；Secret AES-256-GCM 加密存于 `ai-model-connections.json` |
| 槽位绑定 | 「功能绑定与任务规则」Tab 将 `profileSlot` 绑定到 `modelConnectionId`（`PUT /api/admin/ai-model-bindings`） |
| 任务规则 | 每 **active** capability 可维护 draft → publish 版本链；未发布时使用 **builtin** 规则（`ai-task-rules.json`） |
| 运行时 | `resolveAiExecutionPlan` 组装 system policy + 已发布/builtin 规则 + 输出契约 → **单次** Provider 调用；**禁止**二次确认 pass |
| 生成元数据 | `TextGenerationJob` 写入 `capabilityId`、`taskRuleSource/Version/Hash`、`modelConnectionId`、`systemPolicyVersion`、`outputContractVersion`、`inputFingerprint` |
| planned | **仍 planned** — 任务规则与 modelConnection **不能**将 `script.episodes.generate` / `script.continue.generate` 激活；规则 check 拒绝「改为 active」类指令 |

---

## Secret storage (AES-256-GCM)

| Question | Answer |
|---|---|
| Disk format (new saves) | **AES-256-GCM** envelope `enc:v1:` + Base64 JSON `{version,algorithm,iv,ciphertext,authTag}` |
| Master key | `AI_CONFIG_ENCRYPTION_KEY` (Base64 → 32 bytes); server-only; not in `data/` |
| Missing master key | Non-secret config readable; **cannot save new API Keys**; encrypted secrets undecryptable → `AI_PROVIDER_CREDENTIAL_UNAVAILABLE` |
| Legacy plaintext | Readable in-memory only; admin health shows re-save tip; re-save with master key encrypts |
| GET | `hasApiKey` + `apiKeyMasked` only; never raw key |
| Audit / errors / drafts | No raw key |

---

## Classification legend

| Tag | Meaning |
|-----|---------|
| AI_REQUIRED | Calls or must call a model (mock/http/paid) |
| AI_OPTIONAL | Deterministic local algorithm; model optional |
| NON_AI | Save/import/export/upload/playback; not model-bound |
| PLANNED_STUB | UI/handler exists; capability `status: planned` |
| DEPRECATED | No active UI |

---

## Active AI capabilities (registry · `status: active`)

| capabilityId | label | buttonText | surface | route / API | modality | requiresCredits | paidRisk | profile slot | streaming | cancel |
|---|---|---|---|---|---|:---:|:---:|---|:---:|:---:|
| story.generate | 故事生成 | 生成 | StoryCreationWorkspace | POST .../text-generations (`outputKind=story`) | text | yes | possible | story-text | yes | yes |
| script.outline.generate | 剧本大纲生成 | 生成 | discuss-outline | POST .../text-generations (`script_outline`) | text | yes | possible | script-outline-text | yes | yes |
| script.split.generate | 智能剧本分集 | 分集 | ScriptCreationWorkspace | apply-split / confirm-split + text-generations (`script_split`) | text | yes | possible | script-split-text | yes | yes |
| asset.episode-design.generate | 单集资产设计生成 | 提取/重新提取 | EpisodeAssetDesignWorkspace | POST .../text-generations → apply-generation | text | yes | possible | episode-asset-design-text | yes | yes |
| asset.design-prompt.generate | 资产设计提示词 | 设计弹窗自动/生成 | DesignAssetModal | POST .../items/[id]/generate-prompt | text | yes | possible | asset-design-prompt-text | yes | yes |
| image.character.generate | 角色外貌生成 | 生成资产/生成外貌 | DesignAssetModal / CharacterPromptPanel | generate-asset / character-image | image | no | possible | character-image | no | no |
| image.scene.generate | 场景画面生成 | 生成资产/生成场景图 | DesignAssetModal / ScenePromptPanel | generate-asset / scene-image | image | no | possible | scene-image | no | no |
| image.prop.generate | 道具外观生成 | 生成资产 | DesignAssetModal | generate-asset | image | no | possible | prop-image | no | no |
| audio.character-voice.generate | 角色声音生成 | 生成声音 | CharacterPromptPanel | POST /api/generate/character-voice | audio | no | possible | character-voice | no | no |
| video.storyboard-shot.generate | 单镜视频生成 | 生成本镜头视频 | ShotVideoGenerationButton | POST .../shots/[shotId]/generate-video | video | yes | **paid** | video-shot | no | yes |
| video.storyboard-episode.generate | 整集视频生成 | 一键生成本集视频 | EpisodeVideoGenerationButton | POST .../storyboard/generate-videos | video | yes | **paid** | video-shot | no | yes |
| video.workflow-node.generate | 工作流视频生成 | 确认生成 | GenerationConfirmationDrawer | POST /api/generations | video | yes | **paid** | video-shot | no | yes |

Descriptors: `src/ai-config/action-descriptors.ts`. Coverage: `active-capability-coverage.test.ts`.

### Credits note (known inconsistency)

- **Text** capabilities：`requiresCredits: true` → `credits.json` reserve/settle/release via `run-generation.ts`.
- **Video** capabilities：registry **`requiresCredits: true`**，但 `video-generation` 模块 **不 deduct `credits.json`**（idempotency file-store reserve only；`GET /api/credits` 不受影响）。

---

## Planned stubs (`status: planned`)

| capabilityId | label | buttonText | surface | actionTaken |
|---|---|---|---|---|
| script.episodes.generate | 根据大纲生成剧集 | 生成 | StoryCreationWorkspace / 直生剧集 | UI wired；`outputKind=script_episodes` → 服务端 `AI_CAPABILITY_PLANNED` 拒绝（E2 暂停） |
| script.continue.generate | 剧集续写 | 继续生成 | StoryCreationWorkspace | 按钮 disabled / toast「功能开发中」 |

---

## asset.episode-design.generate（active · 详细）

| 项 | 值 |
|---|---|
| 页面 | `/app/projects/[id]/assets/design`（仅 owner）· `/app/workspace/.../assets/design`（owner 或已分配 CE）· `EpisodeAssetDesignWorkspace` |
| 按钮 | 「提取本集资产」/「重新提取」；生成中「取消生成」；「保存本集资产」；「确认本集资产」；「手动添加」；「查看本集剧本」（只读弹窗，NON_AI）；「设计」 |
| Handler | SSE `streamStoryGeneration({ outputKind: "episode_asset_design", episodeId })` → `POST .../apply-generation` → `PUT` save → `POST .../confirm` |
| 产品语义 | **单集资产设计提取**（该集 `script.json` 正文；非全剧本） |
| outputKind | `episode_asset_design` → fixed capability mapping；需 `episodeId` |
| Profile slot | `episode-asset-design-text` |
| 结构化输出 | episode-asset-design schema（角色/场景/道具/音频需求项） |
| 持久化 | 管理：`drafts/episode-asset-designs.json`；工作台：snapshot + workspaceLocal（**不共用** assets.json） |
| 确认 | `create_new` → 合并 `assets.json`；`link_existing` / `ignore`；**atomicWriteTwoJsonFiles** |
| 失效 | `getScriptEpisodeContentFingerprint` → stale |
| credits | text-generations path only；apply/save/confirm 不再扣费 |
| cancel | POST .../text-generations/[id]/cancel |
| 权限 | 管理端：`requireActualProjectOwner`；工作台：`requireWorkspaceAssetAccess`（含 CE） |
| 非目标 | **不**自动调用 image/audio/video 模型；audio 生成未配置时 `AUDIO_GENERATION_UNAVAILABLE`（禁 PNG 冒充） |

---

## script.episodes.generate（planned）

| 项 | 值 |
|---|---|
| 页面 | `/app/projects/[id]/story` · 剧本模式 · 「直生剧集」 |
| Registry | `status: planned` · `classification: PLANNED_STUB` · `defaultProfileSlot: null` |
| 服务端 | `resolveAiCapabilityRuntimeConfig` 拒绝；`AI_CAPABILITY_PLANNED` |
| 备注 | 客户端/UI 骨架保留；E2 批次暂停 — **勿记为 active** |

---

## script.continue.generate（planned）

| 项 | 值 |
|---|---|
| 页面 | `/app/projects/[id]/story` |
| Registry | `status: planned` · `classification: PLANNED_STUB` |
| UI | 按钮 disabled / 「功能开发中」 |

---

## Paid gate (video)

- Admin may bind `video-shot` profile to provider `aliyun-wan27`; **`allowPaidGeneration` only from env `ALLOW_PAID_GENERATION`**.
- Binding / `confirmPaidGeneration=true` **cannot** bypass `ALLOW_PAID_GENERATION=false`.
- Verified routes (403 `PAID_GENERATION_DISABLED`):
  - `POST .../shots/[shotId]/generate-video`
  - `POST .../storyboard/generate-videos`（零部分提交）
  - `POST /api/generations`
- Default `VIDEO_PROVIDER=mock`：**不扣真实外部费用**。

---

## NON_AI

| surface | buttonText | notes |
|---|---|---|
| StoryboardProductionPanel | 生成本集分镜 | Local structured generate — **not LLM** |
| StoryboardShotAccordion | 重新生成当前镜头提示词 | Local `buildVideoPrompt` |
| ScriptUploadPanel | 导入 TXT/DOCX/MD | Parser only；PDF **不支持** |
| ExportDialog | 合并导出 Word | `exportDocuments` stub — **not** AI |
| EpisodeAssetDesignWorkspace | 查看本集剧本 / 手动添加 / 保存 / 确认 | Draft CRUD；无 model call |
| Assets upload / audio play | 上传 / 播放 | Binary only |

---

## Deprecated

| surface | notes |
|---|---|
| asset-matches API (`/asset-matches/auto`, `confirm`, `[matchId]`) | UI 已删；routes **deprecated** |
| 独立资产匹配页 | UI removed |

---

## null binding

Explicit `profileSlotId: null` → unbound — **never** restored to default slot on merge/read (`mergeBindings`).

---

## Config center（H2 扩展）

- **UI：** `ApiManagePanel` 双 Tab — `ai-config-tab-models`（模型接入）/ `ai-config-tab-rules`（绑定 + 任务规则）
- **Store：**
  - `APP_DATA_DIR/ai-model-connections.json` — modelConnection + slotBindings
  - `APP_DATA_DIR/ai-task-rules.json` — draft / published versions
  - `APP_DATA_DIR/generation-api-configs.json` — legacy profile（v2，仍可用）
- **Admin API：** `model-connections`、`ai-model-bindings`、`ai-task-rules/*`（见 `CURRENT_CODE_AND_BUTTON_MAP.md` §1）
- **Availability：** `GET /api/ai-capabilities/availability`（登录用户；无 secret）
- **Priority：** capability binding → profileSlot → modelConnection → provider。Env 仅 seed 空文件默认值。

---

## Permission

- Config APIs: **SYSTEM_ADMIN** only
- Project AI run（管理端）: **仅实际 owner**（`requireActualProjectOwner`）；非 owner SYSTEM_ADMIN 拒绝
- CARD_ENGINEER：工作台资产 AI（episode-design / design-prompt / generate-asset）允许；管理端拒绝
- audio 资产「生成资产」：无音频能力时禁用/`AUDIO_GENERATION_UNAVAILABLE`，不得走 Mock PNG
