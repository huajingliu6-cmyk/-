/** 单集资产设计（Batch G1） */

import type { VideoRefSafety } from "@/projects/assets/types";

export type EpisodeAssetDesignStatus =
  | "not_started"
  | "generating"
  | "review"
  | "confirmed"
  | "stale"
  | "failed";

export type AssetDesignResolution =
  | "pending"
  | "create_new"
  | "link_existing"
  | "ignore";

export type EpisodeAssetDesignAssetType =
  | "character"
  | "scene"
  | "prop"
  | "audio";

export type EpisodeAssetDesignItemSource = "ai" | "manual";

export type CharacterDesignDraft = {
  description: string;
  appearance: string;
  clothing: string;
  role: string;
  age: string;
  voiceId: string | null;
  voiceName: string | null;
  /** Explicit bind via「绑定音色」; legacy rows with voiceId treat as bound. */
  voiceBound: boolean;
  usageInEpisode: string;
  evidence: string;
};

export type SceneDesignDraft = {
  description: string;
  timeOfDay: string;
  location: string;
  style: string;
  usageInEpisode: string;
  evidence: string;
};

export type PropDesignDraft = {
  description: string;
  propType: string;
  usage: string;
  usageInEpisode: string;
  evidence: string;
};

export type AudioDesignDraft = {
  description: string;
  audioKind: "music" | "sfx" | "narration" | "voice";
  duration: string;
  source: string;
  usageInEpisode: string;
  evidence: string;
};

export type AssetDesignPromptHistorySource =
  | "extract"
  | "regenerate"
  | "manual"
  | "generate_asset";

export type AssetDesignPromptHistoryEntry = {
  text: string;
  generatedAt: string;
  generationId: string | null;
  source: AssetDesignPromptHistorySource;
};

export type AssetDesignPromptState = {
  status: "idle" | "generating" | "ready" | "stale" | "failed";
  text: string;
  generationId: string | null;
  sourceFingerprint: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  errorMessage: string | null;
  /** Recent prompt texts for the design modal history strip */
  history?: AssetDesignPromptHistoryEntry[];
};

export type GeneratedMediaHistoryEntry = {
  mediaId: string;
  prompt: string;
  generatedAt: string;
  mimeType?: string | null;
  promptFingerprint?: string | null;
  /** Seedance 视频参考图预检（按单次生成图） */
  videoRefSafety?: VideoRefSafety | null;
  /** 人物音色绑定（按单次生成图；切换历史须分别绑定） */
  voiceId?: string | null;
  voiceName?: string | null;
  voiceBound?: boolean;
};

export type GeneratedMediaState = {
  currentId: string | null;
  /** Ordered media ids (append-only; must not drop prior generations). */
  historyIds: string[];
  /** Rich per-generation records; preferred over historyIds alone. */
  history?: GeneratedMediaHistoryEntry[];
  status:
    | "idle"
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "stale";
  promptFingerprint: string | null;
  errorMessage: string | null;
  mimeType?: string | null;
  previewKind?: "image" | "audio" | null;
  /** Optional append-only ids approved into the formal library. */
  approvedIds?: string[];
  /** 当前 currentId 对应的视频参考图预检 */
  videoRefSafety?: VideoRefSafety | null;
};

/** Shared text-model chat for one episode (extract → redesign turns). */
export type EpisodeDesignConversationMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  at?: string;
};

export type EpisodeAssetDesignItemBase = {
  id: string;
  name: string;
  resolution: AssetDesignResolution;
  existingAssetId?: string | null;
  libraryAssetId?: string | null;
  source: EpisodeAssetDesignItemSource;
  /** Shared remark visible to everyone with asset access; optional for old data. */
  note?: string;
  designPrompt?: AssetDesignPromptState;
  generatedMedia?: GeneratedMediaState;
};

export type CharacterDesignItem = EpisodeAssetDesignItemBase & {
  assetType: "character";
  draft: CharacterDesignDraft;
};

export type SceneDesignItem = EpisodeAssetDesignItemBase & {
  assetType: "scene";
  draft: SceneDesignDraft;
};

export type PropDesignItem = EpisodeAssetDesignItemBase & {
  assetType: "prop";
  draft: PropDesignDraft;
};

export type AudioDesignItem = EpisodeAssetDesignItemBase & {
  assetType: "audio";
  draft: AudioDesignDraft;
};

export type EpisodeAssetDesignItem =
  | CharacterDesignItem
  | SceneDesignItem
  | PropDesignItem
  | AudioDesignItem;

/** In-flight extract job pointer — persisted so remount can recover busy UI. */
export type EpisodeAssetActiveGeneration = {
  generationId: string | null;
  idempotencyKey: string;
  outputKind: "script_asset_design" | "episode_asset_design";
  startedAt: string;
  updatedAt: string;
};

export type EpisodeAssetDesignRecord = {
  episodeId: string;
  episodeNumber: number;
  status: EpisodeAssetDesignStatus;
  revision: number;
  contentFingerprint: string | null;
  generationId: string | null;
  items: EpisodeAssetDesignItem[];
  /**
   * Episode-scoped text chat seeded by「提取本集资产」.
   * 「重新生成提示词」appends `{name}重新设计` (+ optional 用户素材要求) in the same conversation.
   */
  designConversation?: EpisodeDesignConversationMessage[];
  /** Present while an extract job is queued/running (or until reconcile clears it). */
  activeGeneration?: EpisodeAssetActiveGeneration | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmedRevision: number | null;
  /** Set when upstream episode content changed since local design was saved. */
  staleUpstream?: boolean;
  updatedAt: string;
};

export type ProjectEpisodeAssetDesignStore = {
  projectId: string;
  records: EpisodeAssetDesignRecord[];
  updatedAt: string;
  documentRevision?: number;
};

export const SCRIPT_ASSET_DESIGN_ID = "__full_script__";

/** UI 状态徽章中文标签 */
export const EPISODE_ASSET_DESIGN_STATUS_LABELS: Record<
  EpisodeAssetDesignStatus,
  string
> = {
  not_started: "待提取",
  generating: "提取中",
  review: "待确认",
  confirmed: "已确认",
  stale: "已过期",
  failed: "提取失败",
};

export const ASSET_DESIGN_RESOLUTION_LABELS: Record<
  AssetDesignResolution,
  string
> = {
  pending: "待选择",
  create_new: "新增到资产库",
  link_existing: "关联已有资产",
  ignore: "本集忽略",
};
