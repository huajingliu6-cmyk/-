/** 前后端共用的视频生成规范化类型（勿放服务端密钥逻辑） */

export type VideoProviderId = "mock" | "aliyun-wan27";

export type VideoResolution = "720P" | "1080P";

export type VideoAspectRatio =
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:3"
  | "3:4";

export type WanGenerationMode = "textToVideo" | "referenceToVideo";

export type GenerationJobStatus =
  | "validating"
  | "queued"
  | "processing"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled"
  | "resultTransferFailed";

export type MetadataSource = "none" | "browser" | "server" | "provider";

export type GenerationAssetKind =
  | "character"
  | "scene"
  | "image"
  | "reference_video"
  | "first_frame"
  | "voice";

export type GenerationAssetReference = {
  assetId: string;
  kind: GenerationAssetKind;
  /** 工作流中的展示名，不得当作文件地址发给模型 */
  label: string;
  mimeType: string;
  /** 公网 HTTPS 或本地 /api/assets/...；解析后由服务端变成 URL/base64 */
  sourceUrl: string;
  /** 绑定到主体时的音色（仅 voice） */
  referenceVoiceAssetId?: string;
};

export type DirectorSettings = {
  shotSize?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  colorTone?: string;
  focalLength?: string;
  actionDescription?: string;
  stylePreset?: string;
};

export type NormalizedGenerationSettings = {
  resolution: VideoResolution;
  /** 有首帧时可为 null（比例由首帧决定） */
  aspectRatio: VideoAspectRatio | null;
  durationSeconds: number;
  seed?: number;
  watermark: boolean;
  promptExtend: boolean;
};

export type VideoGenerationInput = {
  shotId: string;
  projectId: string;
  prompt: string;
  negativePrompt?: string;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio | null;
  durationSeconds: number;
  seed?: number;
  watermark: boolean;
  promptExtend: boolean;

  characterReferences: GenerationAssetReference[];
  sceneReferences: GenerationAssetReference[];
  imageReferences: GenerationAssetReference[];
  referenceVideos: GenerationAssetReference[];
  firstFrame?: GenerationAssetReference;

  directorSettings?: DirectorSettings;
  textInputs: string[];

  /** 用户在确认面板中显式选择的参考素材顺序（assetId），用于 ≤5 限制 */
  selectedReferenceAssetIds?: string[];
};

export type InputSummary = {
  hasReferenceImages: boolean;
  hasReferenceVideos: boolean;
  hasFirstFrame: boolean;
  referenceImageCount: number;
  referenceVideoCount: number;
  firstFrameCount: number;
  unsupportedAudioLabels: string[];
};

export type ValidationError = {
  code: string;
  field?: string;
  message: string;
};

export type ProviderCapabilities = {
  providerId: VideoProviderId;
  modes: WanGenerationMode[];
  models: ModelCapability[];
};

export type ModelCapability = {
  providerId: VideoProviderId;
  modelId: string;
  mode: WanGenerationMode;
  supportedResolutions: VideoResolution[];
  supportedAspectRatios: VideoAspectRatio[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** 含参考视频时的最大时长（秒） */
  maxDurationWithReferenceVideoSeconds: number;
  durationStep: number;
  supportsReferenceImages: boolean;
  supportsReferenceVideos: boolean;
  supportsFirstFrame: boolean;
  supportsReferenceVoice: boolean;
  maxReferenceMedia: number;
  maxFirstFrames: number;
  supportsCancellation: boolean;
  cancellationStatuses: Array<"PENDING">;
  resultUrlExpires: string;
  nativeResolution: boolean;
  pricingNotice: string;
};

import type { AssetRecord } from "@/workflow/types";

export type GenerationRecord = {
  id: string;
  projectId: string;
  shotNodeId: string;
  providerId: VideoProviderId;
  providerModelId: string;
  providerTaskId: string;
  mode: WanGenerationMode;
  status: GenerationJobStatus;
  progress: number | null;
  progressLabel: string;
  isMock: boolean;
  requestSnapshot: {
    prompt: string;
    settings: NormalizedGenerationSettings;
    mediaAssetIds: string[];
    unsupportedAudioLabels: string[];
  };
  requestedResolution: VideoResolution;
  requestedAspectRatio: VideoAspectRatio | null;
  requestedDurationSeconds: number;
  providerResolution: string | null;
  providerAspectRatio: string | null;
  providerDurationSeconds: number | null;
  actualWidth: number | null;
  actualHeight: number | null;
  actualDurationSeconds: number | null;
  metadataSource: MetadataSource;
  remoteVideoUrl: string | null;
  localVideoAssetId: string | null;
  resultAsset: AssetRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  idempotencyKey: string | null;
};

export type ProviderGenerationInput = {
  generationId: string;
  input: VideoGenerationInput;
  capability: ModelCapability;
  /** 已解析的媒体（公网 URL 或 data URL），不含本地路径 */
  resolvedMedia: ResolvedProviderMedia[];
};

export type ResolvedProviderMedia = {
  type: "reference_image" | "reference_video" | "first_frame";
  url: string;
  assetId: string;
  label: string;
  referenceVoiceUrl?: string;
};

export type ProviderSubmitResult = {
  providerTaskId: string;
  status: GenerationJobStatus;
  progressLabel: string;
};

export type ProviderStatusResult = {
  providerTaskId: string;
  status: GenerationJobStatus;
  progressLabel: string;
  remoteVideoUrl?: string;
  providerResolution?: string;
  providerAspectRatio?: string;
  providerDurationSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
  rawTaskStatus?: string;
};

export type ProviderCancelResult = {
  cancelled: boolean;
  message: string;
};
