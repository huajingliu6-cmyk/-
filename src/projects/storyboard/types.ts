/** 正式创作（分镜工作台）领域类型 — 与 script-draft / assets-draft 同级的服务端持久化 */

import type { StoryboardVideoDefaults } from "@/projects/storyboard/storyboard-video-params";

/** UI 步骤：1 选择剧集 / 确认剧本，2 分镜创作。旧数据中的 3 会归一化为 2。 */
export type CreationStep = 1 | 2;

export type EpisodeProductionStatus =
  | "awaiting_script"
  /** @deprecated 兼容旧数据；展示时映射为「待生成分镜」 */
  | "awaiting_asset_match"
  /** @deprecated 兼容旧数据；展示时映射为「待生成分镜」 */
  | "assets_pending_confirm"
  | "awaiting_storyboard"
  | "storyboard_generating"
  | "storyboard_incomplete"
  | "storyboard_review"
  | "storyboard_done"
  | "generation_failed";

export type AssetKind = "character" | "scene" | "prop" | "audio";

export type MatchConfidence = "high" | "possible" | "low" | "none";

export type MatchSource = "auto" | "manual";

export type MatchResolution =
  | "unresolved"
  | "matched"
  | "not_needed"
  | "temporary_character"
  | "background_element"
  | "generic_prop_or_sfx";

export type AssetMatchItem = {
  id: string;
  assetType: AssetKind;
  extractedName: string;
  normalizedName: string;
  occurrences: number;
  firstOffset: number;
  otherOffsets: number[];
  matchedAssetId: string | null;
  matchedAssetName: string | null;
  matchedAssetRevision: number | null;
  confidence: MatchConfidence;
  matchSource: MatchSource;
  resolution: MatchResolution;
  locked: boolean;
  confirmed: boolean;
  revision: number;
};

export type ShotRequirementResolution =
  | "UNRESOLVED"
  | "LINKED"
  | "NOT_REQUIRED";

export type ShotAssetRequirement = {
  requirementId: string;
  type: "character" | "prop" | "scene";
  sourceName: string;
  normalizedName: string;
  selectedAssetId: string | null;
  resolution: ShotRequirementResolution;
  manuallyAdded: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShotCompletenessStatus =
  | "needs_assets"
  | "needs_prompt"
  | "complete"
  | "locked"
  | "confirmed";

/** 场景参考图上的人物摆放（镜头级数据） */
export type SceneCharacterPlacement = {
  characterAssetId: string;
  /** 0=左，1=右 */
  x: number;
  /** 0=上，1=下 */
  y: number;
  scale?: number;
  depth?: number;
};

export type StoryboardShot = {
  id: string;
  shotNumber: number;
  durationSeconds: number;
  shotSize: string;
  cameraAngle: string;
  cameraMovement: string;
  composition: string;
  visualDescription: string;
  actionDescription: string;
  dialogue: string;
  soundEffect: string;
  music: string;
  /**
   * @deprecated 镜头内容一句话概述已从前端移除。
   * 旧数据可继续保留该字段；新分镜可为空，不参与确认与视频生成。
   */
  shotSummary: string;
  /** @deprecated 使用 videoPrompt；读取时若 videoPrompt 为空则回退到此字段 */
  promptDraft: string;
  /** 完整视频提示词（主字段） */
  videoPrompt: string;
  /**
   * 最近一次成功生成视频时的内容指纹；变更后标记内容已过期。
   * 旧数据缺省为 null。
   */
  lastVideoContentHash: string | null;
  /** 关联的最新 GenerationRecord id（本集分镜页提交） */
  lastGenerationId: string | null;
  /**
   * 本镜头历史成功/提交过的生成 ID（追加不删）。
   * 旧数据缺省为 []；可与 lastGenerationId 并用。
   */
  videoHistoryGenerationIds: string[];
  /** 生成成功视频是否因分镜内容变更而过期 */
  videoContentStale: boolean;
  requiredCharacters: string[];
  requiredProps: string[];
  requiredScene: string | null;
  characterAssetIds: string[];
  /** @deprecated 使用 sceneAssetId；兼容旧数据多场景 ID */
  sceneAssetIds: string[];
  sceneAssetId: string | null;
  propAssetIds: string[];
  audioAssetIds: string[];
  /**
   * 镜头级媒体版本：assetId → mediaId（approvedMediaIds / gen_*）。
   * 缺省时使用资产主图（primaryMediaId / imageFileName）。
   */
  assetMediaIds?: Record<string, string>;
  /**
   * 场景图上的人物摆放（镜头级，不写入场景资产库）。
   * x/y 为相对场景图片显示区域的归一化坐标 [0,1]。
   */
  sceneCharacterPlacements?: SceneCharacterPlacement[];
  requirements: ShotAssetRequirement[];
  manuallyEdited: boolean;
  /** 锁定提示词，批量生成不得覆盖 */
  promptLocked: boolean;
  /** 整镜锁定（兼容旧字段；与 promptLocked 同步推进） */
  locked: boolean;
  confirmed: boolean;
  revision: number;
  order: number;
  /** 单镜提示词重生成幂等键；旧数据缺省为 null */
  promptRegenJobId: string | null;
};

export type StoryboardScene = {
  id: string;
  sceneNumber: number;
  title: string;
  location: string;
  timeOfDay: string;
  interiorExterior: "INT" | "EXT" | "未知";
  summary: string;
  characterAssetIds: string[];
  sceneAssetIds: string[];
  propAssetIds: string[];
  order: number;
  shots: StoryboardShot[];
  confirmed: boolean;
};

export type StoryboardDocument = {
  id: string;
  version: number;
  status: "draft" | "ready" | "confirmed" | "stale";
  sourceScriptHash: string;
  sourceAssetSnapshotHash: string;
  generationJobId: string | null;
  scenes: StoryboardScene[];
  /**
   * 本集分镜曾产生的全部视频生成 ID（追加不删）。
   * 修改剧本/重生分镜后仍保留，供任意镜头预览历史读取。
   */
  videoHistoryGenerationIds: string[];
  confirmedAt: string | null;
  confirmedBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type EpisodeProduction = {
  id: string;
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  currentStep: CreationStep;
  status: EpisodeProductionStatus;
  /** Working script text (editable before confirm) */
  workingScriptText: string;
  workingScriptRevision: number;
  confirmedScriptText: string | null;
  confirmedScriptRevision: number | null;
  confirmedScriptHash: string | null;
  scriptConfirmedAt: string | null;
  scriptConfirmedBy: string | null;
  /** 历史资产匹配记录（新流程不再展示，保留兼容） */
  assetMatches: AssetMatchItem[];
  confirmedAssetSnapshotHash: string | null;
  assetsConfirmedAt: string | null;
  assetsConfirmedBy: string | null;
  assetsStale: boolean;
  storyboardStale: boolean;
  activeStoryboard: StoryboardDocument | null;
  generationError: string | null;
  /** 本集视频批量生成批次（刷新可恢复）；旧数据缺省 null */
  videoGenerationBatch: EpisodeVideoGenerationBatch | null;
  revision: number;
  lastEditedAt: string;
  createdAt: string;
  updatedAt: string;
};

/** 本集一键视频生成批次元数据 */
export type EpisodeVideoGenerationBatch = {
  batchId: string;
  storyboardRevision: number;
  includeSucceeded: boolean;
  createdAt: string;
  shots: Array<{
    shotId: string;
    generationId: string;
    status: string;
  }>;
};

export type ProjectStoryboardWorkspace = {
  projectId: string;
  activeEpisodeId: string | null;
  productions: EpisodeProduction[];
  /** 项目级视频生成默认：比例 / 画质 / 模型 / 风格 */
  videoDefaults?: StoryboardVideoDefaults | null;
  updatedAt: string;
};

export const EPISODE_STATUS_LABEL: Record<EpisodeProductionStatus, string> = {
  awaiting_script: "待确认剧本",
  awaiting_asset_match: "待生成分镜",
  assets_pending_confirm: "待生成分镜",
  awaiting_storyboard: "待生成分镜",
  storyboard_generating: "分镜生成中",
  storyboard_incomplete: "分镜待完善",
  storyboard_review: "分镜待确认",
  storyboard_done: "分镜已确认",
  generation_failed: "生成失败",
};

export const CREATION_STEP_LABEL: Record<CreationStep, string> = {
  1: "选择剧集",
  2: "分镜创作",
};

export const SHOT_STATUS_LABEL: Record<ShotCompletenessStatus, string> = {
  needs_assets: "待补素材",
  needs_prompt: "提示词待完善",
  complete: "已完整",
  locked: "已锁定",
  confirmed: "已确认",
};

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  audio: "音频",
};

export const MATCH_CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  high: "高",
  possible: "可能",
  low: "低",
  none: "无",
};

export const MATCH_RESOLUTION_LABEL: Record<MatchResolution, string> = {
  unresolved: "未处理",
  matched: "已匹配",
  not_needed: "不需要",
  temporary_character: "临时角色",
  background_element: "背景元素",
  generic_prop_or_sfx: "通用道具/音效",
};

export type AssetMediaOption = {
  mediaId: string;
  thumbUrl: string;
  /** 是否为资产当前主图 */
  isPrimary?: boolean;
  /** 仅人物：该图片实际使用的音色显示名。 */
  voiceLabel?: string | null;
};

export type AssetSummaryItem = {
  id: string;
  name: string;
  revision: number;
  /** 是否曾上传参考图（文件名存在）；刷新后 blob URL 可能不可用 */
  hasImage: boolean;
  /** 可展示的图片 URL；无则 UI 使用占位图 */
  thumbUrl: string | null;
  /** 资产库多版本参考图（approvedMediaIds 等）；仅一张时可省略 */
  mediaOptions?: AssetMediaOption[];
  /** 仅人物：是否已绑定音色（有 voiceId） */
  voiceBound?: boolean;
  /** 仅人物：默认音色显示名。 */
  voiceLabel?: string | null;
  /** Seedance 参考图预检 */
  videoRefSafetyStatus?:
    | "pending"
    | "ok"
    | "likely_real_person"
    | "other_risk"
    | "check_failed"
    | null;
};

export type AssetsSummary = {
  characters: AssetSummaryItem[];
  scenes: AssetSummaryItem[];
  props: AssetSummaryItem[];
  audios: AssetSummaryItem[];
};

/** 将持久化步骤归一化为 UI 两步；旧 step=3 / 资产匹配态映射到分镜创作。 */
export function normalizeCreationStep(step: unknown): CreationStep {
  const n = typeof step === "number" ? step : Number(step);
  if (n >= 2) return 2;
  return 1;
}

/** 旧资产匹配状态视为待生成分镜（不阻塞进入分镜创作）。 */
export function normalizeEpisodeStatusForFlow(
  status: EpisodeProductionStatus,
): EpisodeProductionStatus {
  if (status === "awaiting_asset_match" || status === "assets_pending_confirm") {
    return "awaiting_storyboard";
  }
  return status;
}
