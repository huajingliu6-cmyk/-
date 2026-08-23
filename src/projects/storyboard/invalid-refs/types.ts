/**
 * Q80–Q84：分镜资产/媒体失效引用扫描与修复预览类型。
 * 判定以结构化引用为准；名称替换另走预览确认（Q82/Q84）。
 */

export type InvalidRefReasonCode =
  | "ASSET_MISSING"
  | "MEDIA_UNAVAILABLE"
  | "CHARACTER_LOOK_DELETED"
  | "NAME_CHANGED";

export type InvalidRefScope = "episode" | "project";

export type InvalidRefAssetKind = "character" | "scene" | "prop";

export const INVALID_REF_REASON_LABEL: Record<InvalidRefReasonCode, string> = {
  ASSET_MISSING: "资产已变更",
  MEDIA_UNAVAILABLE: "媒体不可用",
  CHARACTER_LOOK_DELETED: "角色造型已删除",
  NAME_CHANGED: "名称已变更，提示词待更新",
};

/** Shot text fields that participate in Q82 name full-text replace. */
export const INVALID_REF_NAME_TEXT_FIELDS = [
  "visualDescription",
  "actionDescription",
  "dialogue",
  "soundEffect",
  "music",
  "videoPrompt",
  "promptDraft",
  "shotSummary",
  "composition",
] as const;

export type InvalidRefNameTextField =
  (typeof INVALID_REF_NAME_TEXT_FIELDS)[number];

export type InvalidRefNameFieldReplacement = {
  field: InvalidRefNameTextField | "requirements.sourceName" | "requiredCharacters" | "requiredProps" | "requiredScene";
  before: string;
  after: string;
};

export type InvalidRefIssue = {
  issueId: string;
  reason: InvalidRefReasonCode;
  label: string;
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  sceneId: string;
  shotId: string;
  shotNumber: number;
  assetKind: InvalidRefAssetKind;
  assetId: string;
  /** Current library name when asset still exists. */
  assetName: string | null;
  /** Structured media id from shot.assetMediaIds when relevant. */
  mediaId: string | null;
  /** Q81: look/media repair must be chosen per shot; never auto-filled. */
  requiresManualMediaSelection: boolean;
  /** Names found in prompts/tokens that no longer match library. */
  oldNames: string[];
  newName: string | null;
  /** Preview-only proposed text replacements (empty until preview built). */
  nameReplacements: InvalidRefNameFieldReplacement[];
  /** Candidate media ids user may pick (certified / allowed). Never auto-applied. */
  selectableMediaIds: string[];
};

export type InvalidRefEpisodeGroup = {
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  issueCount: number;
  pendingManualSelectionCount: number;
  issues: InvalidRefIssue[];
};

export type InvalidRefScanResult = {
  scope: InvalidRefScope;
  episodeId: string | null;
  scannedEpisodeCount: number;
  scannedShotCount: number;
  issueCount: number;
  pendingManualSelectionCount: number;
  episodes: InvalidRefEpisodeGroup[];
};

export type InvalidRefMediaSelection = {
  issueId: string;
  mediaId: string;
};

export type InvalidRefPreviewShotChange = {
  episodeId: string;
  sceneId: string;
  shotId: string;
  shotNumber: number;
  issueIds: string[];
  /** Media map patches (assetId → mediaId). Empty string clears the entry. */
  assetMediaIdPatches: Record<string, string>;
  /** Asset ids to unlink from shot structured bindings (ASSET_MISSING). */
  unlinkAssetIds: string[];
  nameReplacements: InvalidRefNameFieldReplacement[];
  requiresManualMediaSelection: boolean;
  unresolvedIssueIds: string[];
};

export type InvalidRefPreview = {
  previewId: string;
  planDigest: string;
  scope: InvalidRefScope;
  episodeId: string | null;
  canConfirm: boolean;
  blockingReason: string | null;
  shotChanges: InvalidRefPreviewShotChange[];
  mediaSelections: InvalidRefMediaSelection[];
  issueCount: number;
  unresolvedManualCount: number;
};

export type InvalidRefApplyResult = {
  ok: true;
  savedShotCount: number;
  rescan: InvalidRefScanResult;
} | {
  ok: false;
  code: string;
  error: string;
};
