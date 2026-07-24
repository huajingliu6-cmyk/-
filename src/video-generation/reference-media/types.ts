import type { ValidationError } from "../types";

/** 与 ValidationError 同形；生成链路结构化错误别名 */
export type StructuredGenerationError = ValidationError;

export type ReferenceSelectionMode = "auto" | "manual";

export type ReferenceMediaKind = "image" | "video";

export type ReferenceKind =
  | "character"
  | "scene"
  | "general"
  | "referenceVideo";

export type ReferenceMediaCandidate = {
  assetId: string;
  mediaKind: ReferenceMediaKind;
  referenceKind: ReferenceKind;
  sourceNodeId: string;
  sourceNodeType: string;
  sourceNodeTitle: string;
  label: string;
  fileName: string;
  mimeType: string;
  url?: string;
  thumbnailUrl?: string;
  eligible: boolean;
  disabledReason?: string;
  characterVariantName?: string;
  sceneViewpoint?: string;
  imageReferenceType?: string;
};

export type ResolvedReferenceMediaSelection = {
  selected: ReferenceMediaCandidate[];
  excluded: ReferenceMediaCandidate[];
  invalidSelectedIds: string[];
  duplicateSelectedIds: string[];
  mode: ReferenceSelectionMode;
  limit: number;
  requiresManualSelection: boolean;
  validationErrors: StructuredGenerationError[];
};

export type FirstFrameResolution =
  | {
      ok: true;
      firstFrame: ReferenceMediaCandidate | null;
    }
  | {
      ok: false;
      errors: StructuredGenerationError[];
    };
