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
  voiceId: string | null;
  voiceName: string | null;
  voiceStyle: string | null;
  /**
   * 按媒体 id 的音色绑定（同一角色多张生成图各自独立）。
   * `voiceId`/`voiceName` 仍表示当前主图（primary/imageFileName）音色。
   */
  mediaVoices?: Record<
    string,
    { voiceId: string | null; voiceName: string | null }
  >;
  /** 本地上传角色图文件名 */
  imageFileName: string | null;
  /** 本地预览 object URL；本阶段仅内存 */
  imageObjectUrl: string | null;
  imageMimeType: string | null;
  status: AssetStatus;
  /** Append-only approved generated media ids (optional). */
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  approvalProvenance?: AssetApprovalProvenance | null;
  /** 视频参考图预检结果；换图后清空 */
  videoRefSafety?: VideoRefSafety | null;
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
