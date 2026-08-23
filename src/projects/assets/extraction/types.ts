import type {
  AudioDesignDraft,
  CharacterDesignDraft,
  EpisodeAssetDesignAssetType,
  PropDesignDraft,
  SceneDesignDraft,
} from "@/projects/assets/episode-design/types";

export const ASSET_EXTRACTION_UPGRADE_MESSAGE = "系统升级后需重新提取";

export const ASSET_EXTRACTION_NAV_BLOCK_MESSAGE =
  "资产提取尚未完成，请耐心等待。";

export const ASSET_EXTRACTION_MISSING_HINT =
  "若总资产中仍有缺失，请定位资产所在剧集，提取该集资产后会自动合并到总资产。";

export type AssetExtractionTaskStatus =
  | "discovering_roster"
  | "merging_roster"
  | "extracting_details"
  | "retrying_failed_once"
  | "saving"
  | "completed"
  | "failed"
  /** @deprecated persisted legacy; normalized on load */
  | "queued"
  | "discovering"
  | "generating"
  | "applying"
  | "retrying_failed"
  | "partial_completed"
  | "succeeded";

export type AssetExtractionStage =
  | "discovering_roster"
  | "merging_roster"
  | "extracting_details"
  | "retrying_failed_once"
  | "saving"
  | "complete";

export type AssetExtractionProgressPhase =
  | "discovering_roster"
  | "merging_roster"
  | "extracting_details"
  | "retrying_failed_once"
  | "saving"
  | "completed";

export type AssetExtractionProgress = {
  phase: AssetExtractionProgressPhase;
  estimatedProgress: number;
  roster: {
    scannedChunks: number;
    totalChunks: number;
    discoveredCount: number;
  };
  details: {
    totalAssets: number;
    completedAssets: number;
    runningBatches: number;
    completedBatches: number;
    totalBatches: number;
    retryRound: 0 | 1;
  };
};

export const ASSET_EXTRACTION_STAGE_LABELS: Record<AssetExtractionStage, string> =
  {
    discovering_roster: "扫描剧本",
    merging_roster: "整理名单",
    extracting_details: "提取详情",
    retrying_failed_once: "补全详情",
    saving: "保存结果",
    complete: "完成",
  };

export const LIVE_EXTRACTION_STATUSES: AssetExtractionTaskStatus[] = [
  "discovering_roster",
  "merging_roster",
  "extracting_details",
  "retrying_failed_once",
  "saving",
  "queued",
  "discovering",
  "generating",
  "applying",
  "retrying_failed",
];

export function isLiveExtractionStatus(status: string | null | undefined): boolean {
  return (
    status === "discovering_roster" ||
    status === "merging_roster" ||
    status === "extracting_details" ||
    status === "retrying_failed_once" ||
    status === "saving" ||
    status === "queued" ||
    status === "discovering" ||
    status === "generating" ||
    status === "applying" ||
    status === "retrying_failed"
  );
}

export function isCompletedExtractionStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === "completed" ||
    status === "succeeded" ||
    status === "partial_completed"
  );
}

export type AssetExtractionScope = "all" | "episode";

export type AssetExtractionVersionStatus =
  | "active"
  | "candidate"
  | "archived";

export type ExtractedAssetDraft =
  | CharacterDesignDraft
  | SceneDesignDraft
  | PropDesignDraft
  | AudioDesignDraft;

export type ExtractedAsset = {
  identity: string;
  assetType: EpisodeAssetDesignAssetType;
  name: string;
  draft: ExtractedAssetDraft;
  originalAiFingerprint: string;
  sourceEpisodeIds: string[];
  libraryAssetId?: string | null;
  firstSeenOrder?: number;
};

export type AssetRosterItem = {
  assetKey: string;
  type: EpisodeAssetDesignAssetType;
  name: string;
  aliases: string[];
  episodeIds: string[];
  evidenceRefs: string[];
  /** Lower values appear earlier in the asset library (script appearance order). */
  firstSeenOrder?: number;
};

export type AssetDetailTaskItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "terminal_failed";

export type AssetDetailTaskItem = {
  assetKey: string;
  name: string;
  status: AssetDetailTaskItemStatus;
  attempt: number;
  batchIndex?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type AssetExtractionTask = {
  id: string;
  projectId: string;
  taskKey: string;
  sourceFingerprint: string;
  scope: AssetExtractionScope;
  episodeId: string | null;
  modelKey: string;
  status: AssetExtractionTaskStatus;
  stage: AssetExtractionStage;
  estimatedProgress: number;
  revision: number;
  errorMessage: string | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
  roster?: AssetRosterItem[];
  detailItems?: AssetDetailTaskItem[];
  failedAssetQueue?: string[];
  rosterCompletedChunkIds?: string[];
  /** Persisted progress snapshot for overlay / refresh recovery. */
  progress?: AssetExtractionProgress;
  /** Known roster chunk total for progress recovery after refresh. */
  rosterChunksTotal?: number;
};

export type PublicAssetExtractionTask = {
  id: string;
  projectId: string;
  taskKey: string;
  sourceFingerprint: string;
  scope: AssetExtractionScope;
  episodeId: string | null;
  modelKey: string;
  status: AssetExtractionTaskStatus;
  stage: AssetExtractionStage;
  estimatedProgress: number;
  revision: number;
  errorMessage: string | null;
  versionId: string | null;
  createdAt: string;
  updatedAt: string;
  progress: AssetExtractionProgress;
};

export type AssetExtractionVersion = {
  id: string;
  projectId: string;
  sourceFingerprint: string;
  status: AssetExtractionVersionStatus;
  modelKey: string;
  attempt: number;
  createdAt: string;
};

export type AssetExtractionResult = {
  versionId: string;
  scope: AssetExtractionScope;
  episodeId: string | null;
  assets: ExtractedAsset[];
};

export type AssetManualOverride = {
  projectId: string;
  versionId: string;
  assetIdentity: string;
  fields: Record<string, unknown>;
  originalAiFingerprint: string;
  updatedAt: string;
};

export type AssetExtractionStore = {
  projectId: string;
  migratedFromLegacy: boolean;
  tasks: AssetExtractionTask[];
  versions: AssetExtractionVersion[];
  results: AssetExtractionResult[];
  overrides: AssetManualOverride[];
  updatedAt: string;
  documentRevision?: number;
};

export type ConflictKind = "changed" | "removed";

export type ExtractionConflict = {
  identity: string;
  assetType: EpisodeAssetDesignAssetType;
  name: string;
  kind: ConflictKind;
  activeAsset: ExtractedAsset | null;
  candidateAsset: ExtractedAsset | null;
};

export type ConflictDecision = {
  identity: string;
  kind: ConflictKind;
  choice: "use_ai" | "keep_manual" | "keep" | "remove";
};

export const DEFAULT_ASSET_EXTRACTION_MODEL_KEY = "deepseek-v4-pro";
