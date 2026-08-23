import type { CharacterAsset } from "./types";
import { resolveAssetImageStorageKey } from "./asset-image-url";
import { getCharacterMediaVideoRefSafety } from "./character-media-video-ref";
import { mergeMediaIdLists } from "./episode-design/generated-media-history";

function dedupeMediaIds(ids: readonly string[]): string[] {
  return mergeMediaIdLists(ids);
}

function resolveUploadStorageKey(asset: CharacterAsset): string | null {
  if (!asset.imageFileName?.trim()) return null;
  return resolveAssetImageStorageKey({
    id: asset.id,
    imageFileName: asset.imageFileName,
    primaryMediaId: asset.primaryMediaId,
    approvedMediaIds: asset.approvedMediaIds,
  });
}

export function resolveCharacterPrimaryMediaId(
  asset: CharacterAsset,
): string | null {
  const primary = asset.primaryMediaId?.trim();
  if (primary) return primary;
  if (asset.imageFileName?.trim()) {
    return resolveAssetImageStorageKey({
      id: asset.id,
      imageFileName: asset.imageFileName,
      primaryMediaId: asset.primaryMediaId,
      approvedMediaIds: asset.approvedMediaIds,
    });
  }
  return null;
}

function rebuildApprovedMediaIds(
  primary: string | null,
  history: string[],
  look: string[],
  existing?: string[],
): string[] {
  return mergeMediaIdLists(
    primary ? [primary] : [],
    history,
    look,
    existing,
  );
}

function excludeIds(ids: string[], exclude: Set<string>): string[] {
  return ids.filter((id) => !exclude.has(id));
}

export function normalizeCharacterMediaLists(
  asset: CharacterAsset,
): CharacterAsset {
  const primary = resolveCharacterPrimaryMediaId(asset);
  const uploadKey = resolveUploadStorageKey(asset);
  const isPrimaryUpload =
    primary != null && uploadKey != null && primary === uploadKey;

  let historyMediaIds: string[];
  let lookMediaIds: string[];

  const historyDefined = asset.historyMediaIds !== undefined;
  const lookDefined = asset.lookMediaIds !== undefined;

  if (!historyDefined && !lookDefined) {
    const exclude = new Set<string>();
    if (primary) exclude.add(primary);
    if (isPrimaryUpload && asset.id) exclude.add(asset.id);

    lookMediaIds = dedupeMediaIds(
      excludeIds(asset.approvedMediaIds ?? [], exclude),
    );
    historyMediaIds = [];
  } else {
    historyMediaIds = dedupeMediaIds(asset.historyMediaIds ?? []);
    lookMediaIds = dedupeMediaIds(asset.lookMediaIds ?? []);
  }

  if (primary) {
    const primarySet = new Set([primary]);
    historyMediaIds = excludeIds(historyMediaIds, primarySet);
    lookMediaIds = excludeIds(lookMediaIds, primarySet);
  }

  const approvedMediaIds = rebuildApprovedMediaIds(
    primary,
    historyMediaIds,
    lookMediaIds,
    asset.approvedMediaIds,
  );

  return {
    ...asset,
    ...(primary ? { primaryMediaId: primary } : {}),
    historyMediaIds,
    lookMediaIds,
    ...(approvedMediaIds.length > 0 ? { approvedMediaIds } : {}),
  };
}

export function setCharacterPrimary(
  asset: CharacterAsset,
  nextMediaId: string,
): CharacterAsset {
  const normalized = normalizeCharacterMediaLists(asset);
  const trimmed = nextMediaId.trim();
  const oldPrimary = resolveCharacterPrimaryMediaId(normalized);

  let historyMediaIds = [...(normalized.historyMediaIds ?? [])];
  if (oldPrimary && oldPrimary !== trimmed) {
    historyMediaIds = dedupeMediaIds([oldPrimary, ...historyMediaIds]);
  }

  const trimmedSet = new Set([trimmed]);
  historyMediaIds = excludeIds(historyMediaIds, trimmedSet);
  const lookMediaIds = excludeIds(normalized.lookMediaIds ?? [], trimmedSet);

  // Voice is character/appearance scoped — never adopt mediaVoices on primary switch.
  const approvedMediaIds = rebuildApprovedMediaIds(
    trimmed,
    historyMediaIds,
    lookMediaIds,
    normalized.approvedMediaIds,
  );

  return {
    ...normalized,
    primaryMediaId: trimmed,
    imageFileName: trimmed,
    historyMediaIds,
    lookMediaIds,
    approvedMediaIds,
    videoRefSafety: getCharacterMediaVideoRefSafety(normalized, trimmed),
  };
}

export function moveCharacterHistoryToLook(
  asset: CharacterAsset,
  mediaId: string,
): CharacterAsset {
  const normalized = normalizeCharacterMediaLists(asset);
  const trimmed = mediaId.trim();
  const history = normalized.historyMediaIds ?? [];
  if (!history.includes(trimmed)) {
    throw new Error("NOT_IN_HISTORY");
  }

  const historyMediaIds = history.filter((id) => id !== trimmed);
  const lookMediaIds = dedupeMediaIds([
    ...(normalized.lookMediaIds ?? []),
    trimmed,
  ]);
  const primary = resolveCharacterPrimaryMediaId(normalized);

  const approvedMediaIds = rebuildApprovedMediaIds(
    primary,
    historyMediaIds,
    lookMediaIds,
    normalized.approvedMediaIds,
  );

  return {
    ...normalized,
    historyMediaIds,
    lookMediaIds,
    approvedMediaIds,
  };
}

export function addCharacterLook(
  asset: CharacterAsset,
  mediaId: string,
): CharacterAsset {
  const normalized = normalizeCharacterMediaLists(asset);
  const trimmed = mediaId.trim();
  // Prefer appearances when present — lookMediaIds stays a sync mirror.
  if (Array.isArray(normalized.appearances)) {
    const already = normalized.appearances.some(
      (item) =>
        item.currentMediaId === trimmed || item.mediaHistory.includes(trimmed),
    );
    if (already) {
      return {
        ...normalized,
        lookMediaIds: dedupeMediaIds([
          ...(normalized.lookMediaIds ?? []),
          trimmed,
        ]),
      };
    }
  }
  const lookMediaIds = dedupeMediaIds([
    ...(normalized.lookMediaIds ?? []),
    trimmed,
  ]);
  const primary = resolveCharacterPrimaryMediaId(normalized);

  const approvedMediaIds = rebuildApprovedMediaIds(
    primary,
    normalized.historyMediaIds ?? [],
    lookMediaIds,
    normalized.approvedMediaIds,
  );

  return {
    ...normalized,
    lookMediaIds,
    approvedMediaIds,
  };
}

export function listCharacterHistoryMediaIds(asset: CharacterAsset): string[] {
  return [...(normalizeCharacterMediaLists(asset).historyMediaIds ?? [])];
}

export function listCharacterLookMediaIds(asset: CharacterAsset): string[] {
  return [...(normalizeCharacterMediaLists(asset).lookMediaIds ?? [])];
}

/** Default look label when mediaDisplayNames has no entry. */
export function defaultCharacterMediaDisplayName(mediaId: string): string {
  const id = mediaId.trim();
  if (id.startsWith("gen_")) return `生成造型 ${id.slice(4, 12)}`;
  if (id.startsWith("upload_")) return `上传造型 ${id.slice(7, 15)}`;
  return id;
}

export function getCharacterMediaDisplayName(
  asset: CharacterAsset,
  mediaId: string,
): string {
  const custom = asset.mediaDisplayNames?.[mediaId]?.trim();
  if (custom) return custom;
  return defaultCharacterMediaDisplayName(mediaId);
}

/**
 * Formal looks only (excludes primary). Primary is always rendered first by UI.
 * Remaining looks: newest manual shot.assetMediaIds selection first.
 */
export function listSortedCharacterLookMediaIds(asset: CharacterAsset): string[] {
  const looks = listCharacterLookMediaIds(asset);
  const lastUsed = asset.mediaLastUsedAt ?? {};
  return [...looks].sort((a, b) => {
    const ta = lastUsed[a] ? Date.parse(lastUsed[a]!) : Number.NaN;
    const tb = lastUsed[b] ? Date.parse(lastUsed[b]!) : Number.NaN;
    const aHas = Number.isFinite(ta);
    const bHas = Number.isFinite(tb);
    if (aHas && bHas && tb !== ta) return tb - ta;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return looks.indexOf(a) - looks.indexOf(b);
  });
}

export function updateCharacterMediaDisplayName(
  asset: CharacterAsset,
  mediaId: string,
  displayName: string,
): CharacterAsset {
  const trimmedId = mediaId.trim();
  const name = displayName.trim();
  const nextNames = { ...(asset.mediaDisplayNames ?? {}) };
  if (!name) {
    delete nextNames[trimmedId];
  } else {
    nextNames[trimmedId] = name;
  }
  return {
    ...asset,
    mediaDisplayNames:
      Object.keys(nextNames).length > 0 ? nextNames : undefined,
  };
}

export function touchCharacterMediaLastUsed(
  asset: CharacterAsset,
  mediaId: string,
  at: string = new Date().toISOString(),
): CharacterAsset {
  const trimmed = mediaId.trim();
  if (!trimmed) return asset;
  return {
    ...asset,
    mediaLastUsedAt: {
      ...(asset.mediaLastUsedAt ?? {}),
      [trimmed]: at,
    },
  };
}

/**
 * Clear primary without deleting other looks / look history / appearance
 * voice overrides. Does not change status.
 * Clears character default voice — caller must re-bind after primary is empty.
 * Keeps mediaVoices / mediaVideoRefSafety / display names for remaining media.
 */
export function clearCharacterPrimary(asset: CharacterAsset): CharacterAsset {
  const normalized = normalizeCharacterMediaLists(asset);
  const formerPrimary = resolveCharacterPrimaryMediaId(normalized);
  const historyMediaIds = [...(normalized.historyMediaIds ?? [])];
  const lookMediaIds = [...(normalized.lookMediaIds ?? [])];
  const approvedMediaIds = rebuildApprovedMediaIds(
    null,
    historyMediaIds,
    lookMediaIds,
    // Drop the former primary from approved; keep looks + history only.
    (normalized.approvedMediaIds ?? []).filter((id) => id !== formerPrimary),
  );
  return {
    ...normalized,
    primaryMediaId: null,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    videoRefSafety: null,
    voiceId: null,
    voiceName: null,
    historyMediaIds,
    lookMediaIds,
    approvedMediaIds,
    // appearances / voiceOverride* left untouched
  };
}

/**
 * Remove a media from primary / look / history / appearance references and
 * name/usage maps. Clearing the primary also clears character default voice
 * (see clearCharacterPrimary); appearance voice overrides for other media stay.
 */
export function removeCharacterMediaReference(
  asset: CharacterAsset,
  mediaId: string,
): CharacterAsset {
  const trimmed = mediaId.trim();
  const normalized = normalizeCharacterMediaLists(asset);
  const primary = resolveCharacterPrimaryMediaId(normalized);
  const isPrimary = primary === trimmed;

  let appearances = normalized.appearances;
  if (Array.isArray(appearances)) {
    appearances = appearances
      .map((item) => {
        const history = item.mediaHistory.filter((id) => id !== trimmed);
        const current =
          item.currentMediaId === trimmed ? null : item.currentMediaId;
        return {
          ...item,
          currentMediaId: current,
          mediaHistory: current
            ? history.includes(current)
              ? history
              : [current, ...history]
            : history,
          revision: item.revision + 1,
        };
      })
      // Drop appearances that no longer hold any media after removal.
      .filter(
        (item) =>
          item.currentMediaId != null || item.mediaHistory.length > 0,
      );
  }

  let next: CharacterAsset = {
    ...normalized,
    historyMediaIds: (normalized.historyMediaIds ?? []).filter(
      (id) => id !== trimmed,
    ),
    lookMediaIds: (normalized.lookMediaIds ?? []).filter((id) => id !== trimmed),
    approvedMediaIds: (normalized.approvedMediaIds ?? []).filter(
      (id) => id !== trimmed,
    ),
    ...(appearances ? { appearances } : {}),
  };

  if (isPrimary) {
    next = clearCharacterPrimary(next);
  }

  if (next.mediaDisplayNames && trimmed in next.mediaDisplayNames) {
    const mediaDisplayNames = { ...next.mediaDisplayNames };
    delete mediaDisplayNames[trimmed];
    next = {
      ...next,
      mediaDisplayNames:
        Object.keys(mediaDisplayNames).length > 0
          ? mediaDisplayNames
          : undefined,
    };
  }
  if (next.mediaLastUsedAt && trimmed in next.mediaLastUsedAt) {
    const mediaLastUsedAt = { ...next.mediaLastUsedAt };
    delete mediaLastUsedAt[trimmed];
    next = {
      ...next,
      mediaLastUsedAt:
        Object.keys(mediaLastUsedAt).length > 0 ? mediaLastUsedAt : undefined,
    };
  }
  if (next.mediaLookProvenance && trimmed in next.mediaLookProvenance) {
    const mediaLookProvenance = { ...next.mediaLookProvenance };
    delete mediaLookProvenance[trimmed];
    next = {
      ...next,
      mediaLookProvenance:
        Object.keys(mediaLookProvenance).length > 0
          ? mediaLookProvenance
          : undefined,
    };
  }

  // Re-sync lookMediaIds from appearances when present.
  if (Array.isArray(next.appearances)) {
    next = {
      ...next,
      lookMediaIds: dedupeMediaIds(
        next.appearances
          .map((item) => item.currentMediaId)
          .filter((id): id is string => Boolean(id)),
      ),
    };
  }

  return normalizeCharacterMediaLists(next);
}

/** Exclusive generated blobs eligible for physical delete when unused. */
export function isExclusiveGeneratedMediaBlob(mediaId: string): boolean {
  return (
    typeof mediaId === "string" &&
    mediaId.startsWith("gen_") &&
    /^gen_[A-Za-z0-9_-]+$/.test(mediaId)
  );
}

export function characterHasPrimaryMedia(asset: CharacterAsset): boolean {
  return resolveCharacterPrimaryMediaId(asset) != null;
}
