import { safeRandomUUID } from "@/lib/safe-random-id";
import type {
  CharacterAppearance,
  CharacterAsset,
  CharacterVoiceBindingScope,
} from "@/projects/assets/types";
import {
  normalizeCharacterMediaLists,
  resolveCharacterPrimaryMediaId,
  getCharacterMediaDisplayName,
} from "@/projects/assets/character-media-state";

export type ActiveVisualContext = {
  characterId: string;
  /** null = 主形象 */
  appearanceId: string | null;
  mediaId: string | null;
};

function newAppearanceId(): string {
  return `look_${safeRandomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Migrate legacy lookMediaIds into first-class appearances when missing. */
export function ensureCharacterAppearances(
  asset: CharacterAsset,
): CharacterAsset {
  const normalized = normalizeCharacterMediaLists(asset);
  if (Array.isArray(normalized.appearances)) {
    const appearances = normalized.appearances.map((item) =>
      normalizeAppearance(item),
    );
    return syncLookMediaIdsFromAppearances({
      ...normalized,
      appearances,
    });
  }

  const looks = normalized.lookMediaIds ?? [];
  const appearances: CharacterAppearance[] = looks.map((mediaId, index) => {
    const voice = normalized.mediaVoices?.[mediaId];
    return {
      id: `look_${mediaId}`,
      name:
        getCharacterMediaDisplayName(normalized, mediaId) ||
        `造型 ${index + 1}`,
      promptOverride: "",
      currentMediaId: mediaId,
      mediaHistory: [mediaId],
      voiceOverrideId: voice?.voiceId ?? null,
      voiceOverrideName: voice?.voiceName ?? null,
      revision: 1,
    };
  });

  return syncLookMediaIdsFromAppearances({
    ...normalized,
    appearances,
  });
}

function normalizeAppearance(raw: CharacterAppearance): CharacterAppearance {
  const current = raw.currentMediaId?.trim() || null;
  const history = dedupe([
    ...(Array.isArray(raw.mediaHistory) ? raw.mediaHistory : []),
    ...(current ? [current] : []),
  ]);
  return {
    id: raw.id?.trim() || newAppearanceId(),
    name: raw.name?.trim() || "未命名造型",
    promptOverride: typeof raw.promptOverride === "string" ? raw.promptOverride : "",
    currentMediaId: current,
    mediaHistory: history,
    voiceOverrideId:
      typeof raw.voiceOverrideId === "string" ? raw.voiceOverrideId : null,
    voiceOverrideName:
      typeof raw.voiceOverrideName === "string" ? raw.voiceOverrideName : null,
    revision:
      typeof raw.revision === "number" && Number.isFinite(raw.revision)
        ? Math.max(1, Math.floor(raw.revision))
        : 1,
  };
}

/** Keep lookMediaIds as current appearance images for storyboard compatibility. */
export function syncLookMediaIdsFromAppearances(
  asset: CharacterAsset,
): CharacterAsset {
  const appearances = (asset.appearances ?? []).map(normalizeAppearance);
  const lookMediaIds = dedupe(
    appearances
      .map((item) => item.currentMediaId)
      .filter((id): id is string => Boolean(id)),
  );
  const primary = resolveCharacterPrimaryMediaId(asset);
  const historyMediaIds = dedupe(
    (asset.historyMediaIds ?? []).filter((id) => id !== primary),
  );
  const allAppearanceMedia = dedupe(
    appearances.flatMap((item) => [
      ...(item.currentMediaId ? [item.currentMediaId] : []),
      ...item.mediaHistory,
    ]),
  );
  return {
    ...asset,
    appearances,
    lookMediaIds,
    historyMediaIds,
    approvedMediaIds: dedupe([
      ...(primary ? [primary] : []),
      ...historyMediaIds,
      ...allAppearanceMedia,
      ...(asset.approvedMediaIds ?? []),
    ]),
  };
}

export function listCharacterAppearances(
  asset: CharacterAsset,
): CharacterAppearance[] {
  return ensureCharacterAppearances(asset).appearances ?? [];
}

export function findCharacterAppearance(
  asset: CharacterAsset,
  appearanceId: string | null | undefined,
): CharacterAppearance | null {
  if (!appearanceId) return null;
  return (
    listCharacterAppearances(asset).find((item) => item.id === appearanceId) ??
    null
  );
}

export function resolveActiveMediaId(
  asset: CharacterAsset,
  appearanceId: string | null,
): string | null {
  if (!appearanceId) {
    return resolveCharacterPrimaryMediaId(asset);
  }
  return findCharacterAppearance(asset, appearanceId)?.currentMediaId ?? null;
}

export function resolveScopedVoice(input: {
  character: CharacterAsset;
  appearanceId: string | null;
}): {
  scope: CharacterVoiceBindingScope;
  voiceId: string | null;
  voiceName: string | null;
  inheritsDefault: boolean;
  label: string;
} {
  const character = ensureCharacterAppearances(input.character);
  if (!input.appearanceId) {
    const name = character.voiceName?.trim() || null;
    return {
      scope: "character_default",
      voiceId: character.voiceId,
      voiceName: character.voiceName,
      inheritsDefault: false,
      label: name || "未绑定音色",
    };
  }
  const appearance = findCharacterAppearance(character, input.appearanceId);
  if (appearance?.voiceOverrideId) {
    const name = appearance.voiceOverrideName?.trim() || null;
    return {
      scope: "appearance_override",
      voiceId: appearance.voiceOverrideId,
      voiceName: appearance.voiceOverrideName ?? null,
      inheritsDefault: false,
      label: name || "造型专属音色",
    };
  }
  const inheritedName = character.voiceName?.trim() || null;
  return {
    scope: "appearance_override",
    voiceId: character.voiceId,
    voiceName: character.voiceName,
    inheritsDefault: true,
    label: inheritedName
      ? `继承 · ${inheritedName}`
      : "继承人物默认音色",
  };
}

export function createCharacterAppearance(input: {
  asset: CharacterAsset;
  name?: string;
  promptOverride?: string;
  currentMediaId?: string | null;
  sourceMediaIds?: string[];
}): { asset: CharacterAsset; appearance: CharacterAppearance } {
  const asset = ensureCharacterAppearances(input.asset);
  const mediaId = input.currentMediaId?.trim() || null;
  const appearance: CharacterAppearance = {
    id: newAppearanceId(),
    name: input.name?.trim() || `造型 ${(asset.appearances?.length ?? 0) + 1}`,
    promptOverride: input.promptOverride?.trim() || "",
    currentMediaId: mediaId,
    mediaHistory: dedupe([
      ...(input.sourceMediaIds ?? []),
      ...(mediaId ? [mediaId] : []),
    ]),
    voiceOverrideId: null,
    voiceOverrideName: null,
    revision: 1,
  };
  const next = syncLookMediaIdsFromAppearances({
    ...asset,
    appearances: [...(asset.appearances ?? []), appearance],
  });
  return { asset: next, appearance };
}

export function deleteCharacterAppearance(
  asset: CharacterAsset,
  appearanceId: string,
): CharacterAsset {
  const next = ensureCharacterAppearances(asset);
  return syncLookMediaIdsFromAppearances({
    ...next,
    appearances: (next.appearances ?? []).filter(
      (item) => item.id !== appearanceId,
    ),
  });
}

export function renameCharacterAppearance(
  asset: CharacterAsset,
  appearanceId: string,
  name: string,
): CharacterAsset {
  const next = ensureCharacterAppearances(asset);
  const trimmed = name.trim();
  return syncLookMediaIdsFromAppearances({
    ...next,
    appearances: (next.appearances ?? []).map((item) =>
      item.id === appearanceId
        ? {
            ...item,
            name: trimmed || item.name,
            revision: item.revision + 1,
          }
        : item,
    ),
  });
}

export function updateCharacterAppearancePrompt(
  asset: CharacterAsset,
  appearanceId: string,
  promptOverride: string,
): CharacterAsset {
  const next = ensureCharacterAppearances(asset);
  const exists = (next.appearances ?? []).some((item) => item.id === appearanceId);
  if (!exists) throw new Error("APPEARANCE_NOT_FOUND");
  const trimmed = promptOverride.trim();
  return syncLookMediaIdsFromAppearances({
    ...next,
    appearances: (next.appearances ?? []).map((item) =>
      item.id === appearanceId
        ? {
            ...item,
            promptOverride: trimmed,
            revision: item.revision + 1,
          }
        : item,
    ),
  });
}

export function confirmMainAppearanceMedia(
  asset: CharacterAsset,
  mediaId: string,
  options?: { allowAppearanceMedia?: boolean },
): CharacterAsset {
  const trimmed = mediaId.trim();
  if (!trimmed) throw new Error("MISSING_MEDIA_ID");
  const next = ensureCharacterAppearances(asset);
  const primary = resolveCharacterPrimaryMediaId(next);
  if (
    !options?.allowAppearanceMedia &&
    isAppearanceMedia(next, trimmed) &&
    trimmed !== primary
  ) {
    throw new Error("APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN");
  }

  let historyMediaIds = [...(next.historyMediaIds ?? [])];
  if (primary && primary !== trimmed) {
    historyMediaIds = dedupe([primary, ...historyMediaIds]);
  }
  historyMediaIds = historyMediaIds.filter((id) => id !== trimmed);

  const voiceBinding = next.mediaVoices?.[trimmed];
  return syncLookMediaIdsFromAppearances({
    ...next,
    primaryMediaId: trimmed,
    imageFileName: trimmed,
    historyMediaIds,
    // Character default voice is independent of history switching —
    // only keep existing default; do not adopt mediaVoices binding.
    voiceId: next.voiceId,
    voiceName: next.voiceName,
    voiceStyle: next.voiceStyle,
    videoRefSafety: next.mediaVideoRefSafety?.[trimmed] ?? next.videoRefSafety ?? null,
    // Drop unused voiceBinding intentionally (media-bound voice removed).
    ...(voiceBinding ? {} : {}),
  });
}

/** Confirm media as current image for one appearance only. */
export function confirmAppearanceMedia(
  asset: CharacterAsset,
  appearanceId: string,
  mediaId: string,
): CharacterAsset {
  const trimmed = mediaId.trim();
  if (!trimmed) throw new Error("MISSING_MEDIA_ID");
  const next = ensureCharacterAppearances(asset);
  const primary = resolveCharacterPrimaryMediaId(next);
  if (primary && trimmed === primary) {
    // Allow using a copy of main face as appearance current, but do not mutate main.
  }

  let found = false;
  const appearances = (next.appearances ?? []).map((item) => {
    if (item.id !== appearanceId) return item;
    found = true;
    return {
      ...item,
      currentMediaId: trimmed,
      mediaHistory: dedupe([trimmed, ...item.mediaHistory]),
      revision: item.revision + 1,
    };
  });
  if (!found) throw new Error("APPEARANCE_NOT_FOUND");

  return syncLookMediaIdsFromAppearances({
    ...next,
    appearances,
  });
}

/** Append generated/uploaded media into appearance history and select it as current look media (does not touch character primary). */
export function appendAppearanceMediaHistory(
  asset: CharacterAsset,
  appearanceId: string,
  mediaId: string,
): CharacterAsset {
  const trimmed = mediaId.trim();
  if (!trimmed) throw new Error("MISSING_MEDIA_ID");
  const next = ensureCharacterAppearances(asset);
  let found = false;
  const appearances = (next.appearances ?? []).map((item) => {
    if (item.id !== appearanceId) return item;
    found = true;
    return {
      ...item,
      currentMediaId: trimmed,
      mediaHistory: dedupe([trimmed, ...item.mediaHistory]),
      revision: item.revision + 1,
    };
  });
  if (!found) throw new Error("APPEARANCE_NOT_FOUND");
  return syncLookMediaIdsFromAppearances({ ...next, appearances });
}

/** Append media into main history without changing current primary. */
export function appendMainMediaHistory(
  asset: CharacterAsset,
  mediaId: string,
): CharacterAsset {
  const trimmed = mediaId.trim();
  if (!trimmed) throw new Error("MISSING_MEDIA_ID");
  const next = ensureCharacterAppearances(asset);
  const primary = resolveCharacterPrimaryMediaId(next);
  if (primary === trimmed) return next;
  return syncLookMediaIdsFromAppearances({
    ...next,
    historyMediaIds: dedupe([trimmed, ...(next.historyMediaIds ?? [])]),
  });
}

export function bindCharacterDefaultVoice(
  asset: CharacterAsset,
  voice: { voiceId: string | null; voiceName: string | null; voiceStyle?: string | null },
): CharacterAsset {
  return {
    ...ensureCharacterAppearances(asset),
    voiceId: voice.voiceId,
    voiceName: voice.voiceName,
    voiceStyle: voice.voiceStyle ?? null,
  };
}

export function bindAppearanceVoiceOverride(
  asset: CharacterAsset,
  appearanceId: string,
  voice: { voiceId: string | null; voiceName: string | null },
): CharacterAsset {
  const next = ensureCharacterAppearances(asset);
  let found = false;
  const appearances = (next.appearances ?? []).map((item) => {
    if (item.id !== appearanceId) return item;
    found = true;
    return {
      ...item,
      voiceOverrideId: voice.voiceId,
      voiceOverrideName: voice.voiceName,
      revision: item.revision + 1,
    };
  });
  if (!found) throw new Error("APPEARANCE_NOT_FOUND");
  return syncLookMediaIdsFromAppearances({ ...next, appearances });
}

export function clearAppearanceVoiceOverride(
  asset: CharacterAsset,
  appearanceId: string,
): CharacterAsset {
  return bindAppearanceVoiceOverride(asset, appearanceId, {
    voiceId: null,
    voiceName: null,
  });
}

export function isAppearanceMedia(
  asset: CharacterAsset,
  mediaId: string,
): boolean {
  const trimmed = mediaId.trim();
  if (!trimmed) return false;
  if (
    listCharacterAppearances(asset).some(
      (item) =>
        item.currentMediaId === trimmed || item.mediaHistory.includes(trimmed),
    )
  ) {
    return true;
  }
  if ((asset.lookMediaIds ?? []).includes(trimmed)) return true;
  const provenance = asset.mediaLookProvenance?.[trimmed];
  return provenance?.kind === "library_look_generation";
}

/** Find the look/appearance that owns a media id, if any. */
export function findAppearanceOwningMedia(
  asset: CharacterAsset,
  mediaId: string,
): CharacterAppearance | null {
  const trimmed = mediaId.trim();
  if (!trimmed) return null;
  return (
    listCharacterAppearances(asset).find(
      (item) =>
        item.currentMediaId === trimmed || item.mediaHistory.includes(trimmed),
    ) ?? null
  );
}

export function appearanceOwnsMedia(
  appearance: CharacterAppearance,
  mediaId: string,
): boolean {
  const trimmed = mediaId.trim();
  return (
    appearance.currentMediaId === trimmed ||
    appearance.mediaHistory.includes(trimmed)
  );
}
