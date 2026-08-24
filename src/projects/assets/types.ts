/** 项目视频制作前资产（独立于 project.content） */

export type ProjectAssetType = "character" | "scene" | "prop" | "audio";

/** 草稿 | 已完成 | 待生成 */
export type AssetStatus = "draft" | "completed" | "pending";

export type AssetTabId = ProjectAssetType;

/** Optional provenance from workspace → owner approval promote (backward compatible). */
export type AssetApprovalProvenance = {
  source?: "workspace_approval";
  approvalSubmissionId?: string;
  approvalItemId?: string;
  submittedByUserId?: string;
  submittedAt?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  generatedMediaId?: string;
  assetDesignItemId?: string;
  episodeId?: string;
};

/** Seedance 参考图预检（方舟多模态廉价校验，非 100% 同规则） */
export type VideoRefSafetyStatus =
  | "pending"
  | "ok"
  | "likely_real_person"
  | "other_risk"
  | "check_failed";

export type VideoRefSafety = {
  status: VideoRefSafetyStatus;
  checkedAt: string;
  reason?: string;
  modelId?: string;
};

/** Ownership record for a character look generation result (optional / backward compatible). */
export type CharacterMediaLookProvenance = {
  kind: "library_look_generation";
  jobId?: string;
  projectId?: string;
  assetId?: string;
  scope?: "management" | "workspace";
  /** Preferred timestamp field for new writes. */
  createdAt?: string;
  /** Legacy alias of createdAt (still accepted when reading old data). */
  recordedAt?: string;
};

/** Voice binding is character-default or appearance-override — never mediaId-bound. */
export type CharacterVoiceBindingScope =
  | "character_default"
  | "appearance_override";

/**
 * Independent appearance (人物造型) version under a character.
 * Slot 0 / main 主形象 is NOT an appearance — only looks live here.
 */
export type CharacterAppearance = {
  id: string;
  characterId?: string;
  name: string;
  promptOverride: string;
  currentMediaId: string | null;
  mediaHistory: string[];
  voiceOverrideId: string | null;
  voiceOverrideName?: string | null;
  revision: number;
};

export type CharacterAsset = {
  id: string;
  projectId: string;
  name: string;
  /** 角色定位 / 类型，如女主角 */
  role: string;
  description: string;
  appearance: string;
  clothing: string;
  age: string;
  gender: string;
  /** Character-level default voice (人物默认音色). */
  voiceId: string | null;
  voiceName: string | null;
  voiceStyle: string | null;
  /**
   * @deprecated Legacy per-media voice map. New voice UX uses character default
   * + appearance.voiceOverrideId. Kept for migration / episode-design compat.
   */
  mediaVoices?: Record<
    string,
    { voiceId: string | null; voiceName: string | null }
  >;
  /** First-class 人物造型 layers (independent of 主形象). */
  appearances?: CharacterAppearance[];
  /** 本地上传角色图文件名 */
  imageFileName: string | null;
  /** 本地预览 object URL；本阶段仅内存 */
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  status: AssetStatus;
  /** Union of all approved media ids (primary + history + look + promoted). */
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  /** Former primary (主形象) images kept for reference — never includes look images. */
  historyMediaIds?: string[];
  /**
   * Current image ids of appearances — synced from appearances for storyboard
   * compatibility. Prefer appearances[].currentMediaId as source of truth.
   */
  lookMediaIds?: string[];
  approvalProvenance?: AssetApprovalProvenance | null;
  /**
   * Per-media SD2 person-certification results (authoritative for multi-look).
   * Keyed by mediaId / storage key.
   */
  mediaVideoRefSafety?: Record<string, VideoRefSafety>;
  /**
   * Legacy top-level precheck result. Compatibility mirror of the *current*
   * primary media only — do not treat as authority for other looks.
   */
  videoRefSafety?: VideoRefSafety | null;
  /** Optional display names for look/history media cards (backward compatible). */
  mediaDisplayNames?: Record<string, string>;
  /**
   * ISO timestamps of last *manual* shot.assetMediaIds selection per media.
   * Preview / img2img / open-detail must not update this map.
   */
  mediaLastUsedAt?: Record<string, string>;
  /**
   * Provenance for look media eligible for exclusive blob deletion.
   * Written when a library_look generation result is added as a look.
   */
  mediaLookProvenance?: Record<string, CharacterMediaLookProvenance>;
};

export type SceneAsset = {
  id: string;
  projectId: string;
  name: string;
  sceneType: string;
  description: string;
  timeOfDay: string;
  location: string;
  style: string;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  status: AssetStatus;
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  approvalProvenance?: AssetApprovalProvenance | null;
  videoRefSafety?: VideoRefSafety | null;
  mediaVariantLabels?: Record<string, string>;
  /** Inline variant drafts (no media yet) kept until first image is saved. */
  variantDrafts?: LibraryVariantDraft[];
};

export type LibraryVariantDraft = {
  id: string;
  label: string;
  promptText?: string;
};

export type PropAsset = {
  id: string;
  projectId: string;
  name: string;
  propType: string;
  usage: string;
  description: string;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  status: AssetStatus;
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  approvalProvenance?: AssetApprovalProvenance | null;
  videoRefSafety?: VideoRefSafety | null;
  mediaVariantLabels?: Record<string, string>;
  variantDrafts?: LibraryVariantDraft[];
};

export type AudioAssetKind = "music" | "sfx" | "narration" | "voice";

export type AudioAsset = {
  id: string;
  projectId: string;
  name: string;
  type: AudioAssetKind;
  duration: string;
  source: string;
  /** 展示用原始文件名（二进制落盘于 drafts/asset-audio/{id}） */
  fileName: string | null;
  /** 上传中临时 object URL；持久化时剥离，刷新后不可恢复 */
  objectUrl: string | null;
  mimeType: string | null;
  status: AssetStatus;
};

export type ProjectAssetBundle = {
  projectId: string;
  characters: CharacterAsset[];
  scenes: SceneAsset[];
  props: PropAsset[];
  audios: AudioAsset[];
};

export type VoiceOption = {
  id: string;
  name: string;
  style: string;
  label: string;
};

/** 后续语音合成平台适配预留 */
export type VoiceProvider = {
  id: string;
  listVoices: () => Promise<VoiceOption[]>;
  previewVoice?: (voiceId: string) => Promise<void>;
};

export type CharacterDraftInput = {
  name: string;
  role: string;
  description: string;
  clothing: string;
  age: string;
  voiceId: string | null;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  /** Browser File held until the asset row is persisted, then uploaded. */
  pendingImageFile?: File | null;
};

export type SceneDraftInput = {
  name: string;
  description: string;
  timeOfDay: string;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  pendingImageFile?: File | null;
};

export type PropDraftInput = {
  name: string;
  description: string;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  pendingImageFile?: File | null;
};

export type AudioDraftInput = {
  name: string;
  type: AudioAssetKind;
  duration: string;
  source: string;
  fileName: string | null;
  objectUrl: string | null;
  mimeType: string | null;
  /** Browser File held until the asset row is persisted, then uploaded. */
  pendingAudioFile?: File | null;
};
