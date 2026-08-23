/** Client-safe image generation job types and error codes. */

export type ImageGenerationJobStatus =
  | "queued"
  | "running"
  | "saving"
  | "succeeded"
  | "save_failed"
  | "timed_out_waiting"
  | "failed";

export type ImageGenerationSubjectKind =
  | "library_character"
  | "library_scene"
  | "library_prop"
  | "design_item";

export type ImageGenerationSourceEntry =
  | "library_look"
  | "library_image"
  | "storyboard_image"
  | "design_item"
  | "unknown";

export type ImageGenerationErrorCode =
  | "GENERATION_IN_PROGRESS"
  | "SERVICE_OFFLINE"
  | "SERVICE_QUEUED"
  | "INVALID_PARAMS"
  | "CONTENT_REJECTED"
  | "NETWORK_ERROR"
  | "SAVE_FAILED"
  | "TIMED_OUT"
  | "UNKNOWN_ERROR"
  | "JOB_NOT_FOUND"
  | "RETRY_NOT_ALLOWED"
  | "INSUFFICIENT_CREDITS"
  | "PROCESS_RESTARTED"
  | "PROCESS_SHUTDOWN"
  | "RETRY_PAYLOAD_INCOMPLETE"
  | "REFERENCE_IMAGE_REQUIRED"
  | "TEMP_REFERENCE_STORAGE_LIMIT"
  | "LEASE_MISMATCH";

export type ImageGenerationParamField =
  | "prompt"
  | "referenceImages"
  | "model"
  | "aspectRatio"
  | "quality"
  | "count"
  | "unknown";

/** Whitelisted retry snapshot — no Base64; refs are storage keys only. */
export type ImageGenerationRetrySnapshot = {
  schemaVersion: number;
  prompt: string;
  negativePrompt: string | null;
  mode: "text_to_image" | "image_to_image";
  model: string | null;
  quality: string | null;
  aspectRatio: string | null;
  count: number | null;
  seed: string | null;
  strength: number | null;
  effectivePrompt: string;
  /** Temp reference blob keys (`tmpref_*`) and/or library media ids used as refs. */
  referenceStorageKeys: string[];
  /** Library media ids that were not copied (owned asset refs). */
  libraryReferenceMediaIds: string[];
  multiAngleMode: string | null;
  sceneCharacterPlacementsJson: string | null;
  sourceEntry: ImageGenerationSourceEntry;
};

export type ImageGenerationJobParams = {
  prompt: string;
  mode: "text_to_image" | "image_to_image";
  model?: string;
  quality?: string;
  aspectRatio?: string;
  count?: number;
  /** @deprecated Prefer retrySnapshot.referenceStorageKeys */
  referenceMediaIds?: string[];
  multiAngleMode?: string | null;
  sceneCharacterPlacementsJson?: string | null;
  /** Full server-side retry payload (schemaVersion gated). */
  retrySnapshot?: ImageGenerationRetrySnapshot | null;
};

export type ImageGenerationJob = {
  recordType: "image";
  id: string;
  projectId: string;
  scope: "management" | "workspace";
  subjectKind: ImageGenerationSubjectKind;
  /** Library asset id or design item id. */
  subjectId: string;
  assetKind?: "character" | "scene" | "prop";
  episodeId?: string | null;
  actorUserId: string;
  status: ImageGenerationJobStatus;
  params: ImageGenerationJobParams;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Client/server wait deadline ISO; extend-wait pushes this out. */
  waitDeadlineAt: string | null;
  errorCode: ImageGenerationErrorCode | null;
  /** User-facing Chinese category message (no internals). */
  errorMessage: string | null;
  errorFields: ImageGenerationParamField[];
  mediaIds: string[];
  primaryMediaId: string | null;
  mimeType: string | null;
  /** Whether media has been linked into library/design. */
  savedToLibrary: boolean;
  saveErrorMessage: string | null;
  notificationSent: boolean;
  /** Estimated progress 0-100 (never claimed as real provider progress). */
  estimatedPercent: number;
  creditReservationId: string | null;
  /**
   * Process boot id that enqueued/last owned this job.
   * Stale vs current worker → recover on project open.
   */
  workerInstanceId: string | null;
  /** Lease token required to write running→terminal transitions. */
  leaseToken: string | null;
  /** Last heartbeat from owning worker (ISO). */
  heartbeatAt: string | null;
  /**
   * Upstream provider async task id — unused: 3080 OpenAI-compatible images
   * are sync-only and do not expose a pollable task id.
   */
  providerTaskId: string | null;
  /** Idempotent claim: result already linked/notified. */
  resultClaimed: boolean;
  sourceEntry: ImageGenerationSourceEntry;
};

export const IMAGE_RETRY_SCHEMA_VERSION = 1;

export const IMAGE_JOB_ACTIVE_STATUSES: ImageGenerationJobStatus[] = [
  "queued",
  "running",
  "saving",
  "timed_out_waiting",
];

export const IMAGE_JOB_TERMINAL_STATUSES: ImageGenerationJobStatus[] = [
  "succeeded",
  "save_failed",
  "failed",
];

export const TEMP_REFERENCE_PREFIX = "tmpref_";

export function isTempReferenceStorageKey(id: string): boolean {
  return (
    typeof id === "string" &&
    id.startsWith(TEMP_REFERENCE_PREFIX) &&
    /^[A-Za-z0-9_-]+$/.test(id) &&
    !id.includes("..")
  );
}

export function isImageGenerationJob(value: unknown): value is ImageGenerationJob {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { recordType?: unknown }).recordType === "image" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export function subjectKey(job: Pick<
  ImageGenerationJob,
  "scope" | "projectId" | "subjectKind" | "subjectId"
>): string {
  return `${job.scope}:${job.projectId}:${job.subjectKind}:${job.subjectId}`;
}

export const IMAGE_ERROR_USER_MESSAGE: Record<ImageGenerationErrorCode, string> = {
  GENERATION_IN_PROGRESS: "该素材正在生成中，请等待完成后再试。",
  SERVICE_OFFLINE: "图像服务暂时不可用，请检测服务或稍后再试。",
  SERVICE_QUEUED: "任务排队等待资源中，请稍候。",
  INVALID_PARAMS: "生成参数有误，请检查标红的字段后修改。",
  CONTENT_REJECTED: "内容未通过校验，请调整提示词或参考图后重试。",
  NETWORK_ERROR: "网络异常，请检查连接后手动重试。",
  SAVE_FAILED: "图片已生成，但保存到资产库失败，可重新保存。",
  TIMED_OUT: "等待超时，未收到最终结果。",
  UNKNOWN_ERROR: "生成失败，请稍后重试。",
  JOB_NOT_FOUND: "找不到该生成任务。",
  RETRY_NOT_ALLOWED: "当前任务尚未结束，暂不可重试。",
  INSUFFICIENT_CREDITS: "积分不足，无法生成。",
  PROCESS_RESTARTED: "生成服务中断，请重新生成。",
  PROCESS_SHUTDOWN: "生成服务中断，请重新生成。",
  RETRY_PAYLOAD_INCOMPLETE: "旧任务缺少完整参数，请重新配置生成。",
  REFERENCE_IMAGE_REQUIRED: "参考图缺失或无效，请重新选择参考图后再试。",
  TEMP_REFERENCE_STORAGE_LIMIT: "临时参考图存储已达上限，请先清理无引用参考图后再试。",
  LEASE_MISMATCH: "任务已被其他进程接管，当前结果已忽略。",
};

export const IMAGE_SOURCE_ENTRY_LABEL: Record<ImageGenerationSourceEntry, string> = {
  library_look: "角色造型",
  library_image: "资产图生图",
  storyboard_image: "分镜图生图",
  design_item: "剧集设计",
  unknown: "图片生成",
};
