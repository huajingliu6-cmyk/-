import type {
  CharacterDesignDraft,
  EpisodeAssetDesignItem,
  GeneratedMediaHistoryEntry,
  GeneratedMediaState,
} from "@/projects/assets/episode-design/types";

export type MediaVoiceBinding = {
  voiceId: string | null;
  voiceName: string | null;
  voiceBound: boolean;
};

export function emptyMediaVoiceBinding(): MediaVoiceBinding {
  return { voiceId: null, voiceName: null, voiceBound: false };
}

function entryVoice(
  entry: GeneratedMediaHistoryEntry | undefined,
): MediaVoiceBinding | null {
  if (!entry) return null;
  if (
    entry.voiceId === undefined &&
    entry.voiceName === undefined &&
    entry.voiceBound === undefined
  ) {
    return null;
  }
  const voiceId =
    typeof entry.voiceId === "string" && entry.voiceId.trim()
      ? entry.voiceId.trim()
      : null;
  return {
    voiceId,
    voiceName:
      typeof entry.voiceName === "string" && entry.voiceName.trim()
        ? entry.voiceName.trim()
        : null,
    voiceBound: Boolean(entry.voiceBound && voiceId),
  };
}

/**
 * 按 mediaId 取音色绑定。
 * 兼容旧数据：仅当该图是 currentId 且 history 无绑定时，回退 draft.voice*。
 */
export function getDesignMediaVoiceBinding(
  item: Pick<EpisodeAssetDesignItem, "assetType" | "draft" | "generatedMedia">,
  mediaId: string | null | undefined,
): MediaVoiceBinding {
  if (item.assetType !== "character") return emptyMediaVoiceBinding();
  const id = mediaId?.trim() ?? "";
  if (!id) return emptyMediaVoiceBinding();

  const media = item.generatedMedia;
  const fromHistory = entryVoice(
    media?.history?.find((h) => h.mediaId === id),
  );
  if (fromHistory) return fromHistory;

  const draft = item.draft as CharacterDesignDraft;
  if (media?.currentId === id && (draft.voiceId || draft.voiceBound)) {
    const voiceId = draft.voiceId?.trim() || null;
    return {
      voiceId,
      voiceName: draft.voiceName?.trim() || null,
      voiceBound: Boolean(draft.voiceBound && voiceId),
    };
  }

  return emptyMediaVoiceBinding();
}

export function isMediaVoiceBound(binding: MediaVoiceBinding): boolean {
  return Boolean(binding.voiceBound && binding.voiceId?.trim());
}

/** 写入指定 mediaId 的音色；若为 currentId 则镜像 draft.voice*。 */
export function withDesignMediaVoiceBinding(
  item: EpisodeAssetDesignItem & { assetType: "character" },
  mediaId: string,
  binding: MediaVoiceBinding,
): EpisodeAssetDesignItem {
  const id = mediaId.trim();
  if (!id) return item;

  const baseMedia: GeneratedMediaState = item.generatedMedia ?? {
    currentId: id,
    historyIds: [id],
    status: "completed",
    promptFingerprint: null,
    errorMessage: null,
    previewKind: "image",
  };

  const historyIds = Array.from(
    new Set([...(baseMedia.historyIds ?? []), id]),
  );
  const prevHistory = baseMedia.history ?? [];
  const byId = new Map(prevHistory.map((h) => [h.mediaId, h]));
  for (const mid of historyIds) {
    if (!byId.has(mid)) {
      byId.set(mid, {
        mediaId: mid,
        prompt: "",
        generatedAt: new Date().toISOString(),
      });
    }
  }
  const prev = byId.get(id)!;
  byId.set(id, {
    ...prev,
    mediaId: id,
    voiceId: binding.voiceId,
    voiceName: binding.voiceName,
    voiceBound: binding.voiceBound,
  });
  const history = historyIds.map((mid) => byId.get(mid)!);

  const generatedMedia: GeneratedMediaState = {
    ...baseMedia,
    historyIds,
    history,
  };

  const mirrorDraft =
    !generatedMedia.currentId || generatedMedia.currentId === id
      ? {
          ...item.draft,
          voiceId: binding.voiceId,
          voiceName: binding.voiceName,
          voiceBound: binding.voiceBound,
        }
      : item.draft;

  return {
    ...item,
    draft: mirrorDraft,
    generatedMedia,
  };
}

/** 将预览图设为 current，并用该图音色镜像 draft（卡片区）。 */
export function withDesignCurrentMediaAndVoiceMirror(
  item: EpisodeAssetDesignItem & { assetType: "character" },
  mediaId: string,
): EpisodeAssetDesignItem {
  const id = mediaId.trim();
  if (!id || !item.generatedMedia) return item;
  const binding = getDesignMediaVoiceBinding(item, id);
  return {
    ...item,
    generatedMedia: {
      ...item.generatedMedia,
      currentId: id,
      historyIds: Array.from(
        new Set([...(item.generatedMedia.historyIds ?? []), id]),
      ),
    },
    draft: {
      ...item.draft,
      voiceId: binding.voiceId,
      voiceName: binding.voiceName,
      voiceBound: binding.voiceBound,
    },
  };
}
