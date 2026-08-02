import type {
  AssetDesignPromptHistoryEntry,
  GeneratedMediaHistoryEntry,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";

/** Append-only merge of media id lists — never drop existing ids. */
export function mergeMediaIdLists(
  ...lists: Array<readonly string[] | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const id of list) {
      const trimmed = typeof id === "string" ? id.trim() : "";
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function normalizeHistoryEntry(
  entry: GeneratedMediaHistoryEntry,
): GeneratedMediaHistoryEntry | null {
  const mediaId = entry.mediaId?.trim();
  if (!mediaId) return null;
  return {
    mediaId,
    prompt: typeof entry.prompt === "string" ? entry.prompt : "",
    generatedAt:
      typeof entry.generatedAt === "string" && entry.generatedAt
        ? entry.generatedAt
        : new Date().toISOString(),
    ...(entry.mimeType != null ? { mimeType: entry.mimeType } : {}),
    ...(entry.promptFingerprint != null
      ? { promptFingerprint: entry.promptFingerprint }
      : {}),
    ...(entry.videoRefSafety != null
      ? { videoRefSafety: entry.videoRefSafety }
      : {}),
    ...(entry.voiceId !== undefined ? { voiceId: entry.voiceId } : {}),
    ...(entry.voiceName !== undefined ? { voiceName: entry.voiceName } : {}),
    ...(entry.voiceBound !== undefined ? { voiceBound: entry.voiceBound } : {}),
  };
}

/** Merge rich history entries by mediaId; keep first-seen metadata, fill blanks. */
export function mergeGeneratedMediaHistoryEntries(
  ...lists: Array<readonly GeneratedMediaHistoryEntry[] | null | undefined>
): GeneratedMediaHistoryEntry[] {
  const byId = new Map<string, GeneratedMediaHistoryEntry>();
  const order: string[] = [];
  for (const list of lists) {
    if (!list || !Array.isArray(list)) continue;
    for (const raw of list) {
      const entry = normalizeHistoryEntry(raw);
      if (!entry) continue;
      const prev = byId.get(entry.mediaId);
      if (!prev) {
        byId.set(entry.mediaId, entry);
        order.push(entry.mediaId);
        continue;
      }
      const voiceId =
        entry.voiceId !== undefined ? entry.voiceId : prev.voiceId;
      const voiceName =
        entry.voiceName !== undefined ? entry.voiceName : prev.voiceName;
      const voiceBound =
        entry.voiceBound !== undefined ? entry.voiceBound : prev.voiceBound;
      byId.set(entry.mediaId, {
        mediaId: entry.mediaId,
        prompt: prev.prompt.trim() ? prev.prompt : entry.prompt,
        generatedAt: prev.generatedAt || entry.generatedAt,
        mimeType: prev.mimeType ?? entry.mimeType ?? null,
        promptFingerprint:
          prev.promptFingerprint ?? entry.promptFingerprint ?? null,
        videoRefSafety: entry.videoRefSafety ?? prev.videoRefSafety ?? null,
        ...(voiceId !== undefined ? { voiceId } : {}),
        ...(voiceName !== undefined ? { voiceName } : {}),
        ...(voiceBound !== undefined ? { voiceBound } : {}),
      });
    }
  }
  return order.map((id) => byId.get(id)!);
}

/**
 * Merge generated-media state so history is append-only.
 * Newer `currentId` / status / fingerprint win; ids and entries are never dropped.
 */
export function mergeGeneratedMediaState(
  ...states: Array<GeneratedMediaState | null | undefined>
): GeneratedMediaState | undefined {
  const present = states.filter(
    (s): s is GeneratedMediaState => s != null && typeof s === "object",
  );
  if (present.length === 0) return undefined;

  const history = mergeGeneratedMediaHistoryEntries(
    ...present.map((s) => s.history),
    ...present.map((s) =>
      (s.historyIds ?? []).map((mediaId) => ({
        mediaId,
        prompt: "",
        generatedAt: "",
      })),
    ),
    ...present.map((s) =>
      typeof s.currentId === "string" && s.currentId.trim()
        ? [
            {
              mediaId: s.currentId.trim(),
              prompt: "",
              generatedAt: "",
            },
          ]
        : [],
    ),
  );

  const historyIds = mergeMediaIdLists(
    history.map((h) => h.mediaId),
    ...present.map((s) => s.historyIds),
    ...present.map((s) => (s.currentId ? [s.currentId] : [])),
  );

  const latest = present[present.length - 1]!;
  const currentId =
    (typeof latest.currentId === "string" && latest.currentId.trim()
      ? latest.currentId.trim()
      : null) ??
    historyIds[historyIds.length - 1] ??
    null;

  const approvedIds = mergeMediaIdLists(...present.map((s) => s.approvedIds));

  const safetyFromHistory = currentId
    ? history.find((h) => h.mediaId === currentId)?.videoRefSafety
    : undefined;
  const safetyFromLatest = [...present]
    .reverse()
    .map((s) => s.videoRefSafety)
    .find((s) => s != null);

  return {
    currentId,
    historyIds,
    ...(history.length > 0 ? { history } : {}),
    status: latest.status ?? "idle",
    promptFingerprint: latest.promptFingerprint ?? null,
    errorMessage: latest.errorMessage ?? null,
    mimeType: latest.mimeType ?? null,
    previewKind:
      [...present]
        .reverse()
        .map((s) => s.previewKind)
        .find((k) => k === "image" || k === "audio") ?? null,
    ...(approvedIds.length > 0 ? { approvedIds } : {}),
    videoRefSafety: safetyFromHistory ?? safetyFromLatest ?? null,
  };
}

/** Append one successful generation; never overwrites prior history entries. */
export function appendGeneratedMediaGeneration(
  prev: GeneratedMediaState | undefined,
  input: {
    mediaId: string;
    prompt: string;
    generatedAt: string;
    promptFingerprint: string;
    mimeType?: string | null;
  },
): GeneratedMediaState {
  const entry: GeneratedMediaHistoryEntry = {
    mediaId: input.mediaId,
    prompt: input.prompt,
    generatedAt: input.generatedAt,
    mimeType: input.mimeType ?? null,
    promptFingerprint: input.promptFingerprint,
  };
  return (
    mergeGeneratedMediaState(prev, {
      currentId: input.mediaId,
      historyIds: [input.mediaId],
      history: [entry],
      status: "completed",
      promptFingerprint: input.promptFingerprint,
      errorMessage: null,
      mimeType: input.mimeType ?? null,
      previewKind: "image",
    }) ?? {
      currentId: input.mediaId,
      historyIds: [input.mediaId],
      history: [entry],
      status: "completed",
      promptFingerprint: input.promptFingerprint,
      errorMessage: null,
      mimeType: input.mimeType ?? null,
      previewKind: "image",
    }
  );
}

/** Append-only prompt history — do not truncate or replace prior texts. */
export function appendPromptHistory(
  prev: AssetDesignPromptHistoryEntry[] | undefined,
  entry: AssetDesignPromptHistoryEntry,
): AssetDesignPromptHistoryEntry[] {
  const list = [...(prev ?? [])];
  const last = list[list.length - 1];
  if (last && last.text.trim() === entry.text.trim()) {
    return list;
  }
  list.push(entry);
  return list;
}

/** Merge two prompt history lists without dropping entries. */
export function mergePromptHistories(
  ...lists: Array<readonly AssetDesignPromptHistoryEntry[] | null | undefined>
): AssetDesignPromptHistoryEntry[] {
  const out: AssetDesignPromptHistoryEntry[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const entry of list) {
      if (!entry?.text?.trim()) continue;
      const dup = out.some(
        (p) =>
          p.text.trim() === entry.text.trim() &&
          p.generatedAt === entry.generatedAt,
      );
      if (dup) continue;
      const last = out[out.length - 1];
      if (last && last.text.trim() === entry.text.trim()) continue;
      out.push(entry);
    }
  }
  return out;
}
