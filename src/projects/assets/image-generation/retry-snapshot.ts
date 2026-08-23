import "server-only";

import {
  IMAGE_ERROR_USER_MESSAGE,
  IMAGE_RETRY_SCHEMA_VERSION,
  type ImageGenerationRetrySnapshot,
  type ImageGenerationSourceEntry,
} from "@/projects/assets/image-generation/types";

const SOURCE_ENTRIES = new Set<ImageGenerationSourceEntry>([
  "library_look",
  "library_image",
  "storyboard_image",
  "design_item",
  "unknown",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Whitelist-parse a retry snapshot. Rejects unknown shapes / incomplete payloads.
 */
export function parseRetrySnapshot(
  value: unknown,
):
  | { ok: true; snapshot: ImageGenerationRetrySnapshot }
  | { ok: false; code: "RETRY_PAYLOAD_INCOMPLETE"; message: string } {
  if (!value || typeof value !== "object") {
    return {
      ok: false,
      code: "RETRY_PAYLOAD_INCOMPLETE",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_PAYLOAD_INCOMPLETE,
    };
  }
  const raw = value as Record<string, unknown>;
  const schemaVersion = asFiniteNumber(raw.schemaVersion);
  if (schemaVersion !== IMAGE_RETRY_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "RETRY_PAYLOAD_INCOMPLETE",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_PAYLOAD_INCOMPLETE,
    };
  }
  const prompt = asString(raw.prompt)?.trim() ?? "";
  const mode = raw.mode === "text_to_image" || raw.mode === "image_to_image"
    ? raw.mode
    : null;
  if (!mode) {
    return {
      ok: false,
      code: "RETRY_PAYLOAD_INCOMPLETE",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_PAYLOAD_INCOMPLETE,
    };
  }
  const referenceStorageKeys = Array.isArray(raw.referenceStorageKeys)
    ? raw.referenceStorageKeys.filter(
        (k): k is string => typeof k === "string" && k.length > 0,
      )
    : [];
  const libraryReferenceMediaIds = Array.isArray(raw.libraryReferenceMediaIds)
    ? raw.libraryReferenceMediaIds.filter(
        (k): k is string => typeof k === "string" && k.length > 0,
      )
    : [];
  const sourceEntryRaw = asString(raw.sourceEntry) ?? "unknown";
  const sourceEntry = SOURCE_ENTRIES.has(sourceEntryRaw as ImageGenerationSourceEntry)
    ? (sourceEntryRaw as ImageGenerationSourceEntry)
    : "unknown";

  const snapshot: ImageGenerationRetrySnapshot = {
    schemaVersion: IMAGE_RETRY_SCHEMA_VERSION,
    prompt,
    negativePrompt: asString(raw.negativePrompt),
    mode,
    model: asString(raw.model),
    quality: asString(raw.quality),
    aspectRatio: asString(raw.aspectRatio),
    count: asFiniteNumber(raw.count),
    seed: asString(raw.seed),
    strength: asFiniteNumber(raw.strength),
    effectivePrompt: (asString(raw.effectivePrompt) ?? prompt).trim(),
    referenceStorageKeys,
    libraryReferenceMediaIds,
    multiAngleMode: asString(raw.multiAngleMode),
    sceneCharacterPlacementsJson: asString(raw.sceneCharacterPlacementsJson),
    sourceEntry,
  };

  if (!snapshot.effectivePrompt && snapshot.mode === "image_to_image") {
    // Placement-only scenes may have empty user prompt but still need effectivePrompt.
    if (!snapshot.sceneCharacterPlacementsJson) {
      return {
        ok: false,
        code: "RETRY_PAYLOAD_INCOMPLETE",
        message: IMAGE_ERROR_USER_MESSAGE.RETRY_PAYLOAD_INCOMPLETE,
      };
    }
  }

  return { ok: true, snapshot };
}

export function buildRetrySnapshot(input: {
  prompt: string;
  negativePrompt?: string | null;
  mode: "text_to_image" | "image_to_image";
  model?: string | null;
  quality?: string | null;
  aspectRatio?: string | null;
  count?: number | null;
  seed?: string | null;
  strength?: number | null;
  effectivePrompt: string;
  referenceStorageKeys: string[];
  libraryReferenceMediaIds?: string[];
  multiAngleMode?: string | null;
  sceneCharacterPlacementsJson?: string | null;
  sourceEntry?: ImageGenerationSourceEntry;
}): ImageGenerationRetrySnapshot {
  return {
    schemaVersion: IMAGE_RETRY_SCHEMA_VERSION,
    prompt: input.prompt.trim(),
    negativePrompt: input.negativePrompt?.trim() || null,
    mode: input.mode,
    model: input.model ?? null,
    quality: input.quality ?? null,
    aspectRatio: input.aspectRatio ?? null,
    count: input.count ?? null,
    seed: input.seed ?? null,
    strength: input.strength ?? null,
    effectivePrompt: input.effectivePrompt.trim() || input.prompt.trim(),
    referenceStorageKeys: [...input.referenceStorageKeys],
    libraryReferenceMediaIds: [...(input.libraryReferenceMediaIds ?? [])],
    multiAngleMode: input.multiAngleMode ?? null,
    sceneCharacterPlacementsJson: input.sceneCharacterPlacementsJson ?? null,
    sourceEntry: input.sourceEntry ?? "unknown",
  };
}

export function assertRetrySnapshotComplete(
  snapshot: ImageGenerationRetrySnapshot | null | undefined,
):
  | { ok: true; snapshot: ImageGenerationRetrySnapshot }
  | { ok: false; code: "RETRY_PAYLOAD_INCOMPLETE"; message: string } {
  if (!snapshot) {
    return {
      ok: false,
      code: "RETRY_PAYLOAD_INCOMPLETE",
      message: IMAGE_ERROR_USER_MESSAGE.RETRY_PAYLOAD_INCOMPLETE,
    };
  }
  return parseRetrySnapshot(snapshot);
}
