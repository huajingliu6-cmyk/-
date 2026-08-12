import { withDesignMediaVoiceBinding } from "@/projects/assets/episode-design/design-media-voice";
import type { EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";

export type UpdateMediaVoiceInput = {
  itemId: string;
  mediaId: string;
  voiceId: string | null;
  voiceName: string | null;
  voiceBound: boolean;
};

export function updateDesignMediaVoice(
  record: EpisodeAssetDesignRecord,
  input: UpdateMediaVoiceInput,
): EpisodeAssetDesignRecord {
  const target = record.items.find((item) => item.id === input.itemId);

  if (!target) throw new Error("ASSET_DESIGN_ITEM_NOT_FOUND");
  if (target.assetType !== "character") {
    throw new Error("ASSET_DESIGN_ITEM_NOT_CHARACTER");
  }

  const mediaId = input.mediaId.trim();
  const mediaExists =
    target.generatedMedia?.currentId === mediaId ||
    Boolean(target.generatedMedia?.historyIds?.includes(mediaId)) ||
    Boolean(
      target.generatedMedia?.history?.some(
        (entry) => entry.mediaId === mediaId,
      ),
    );

  if (!mediaId || !mediaExists) {
    throw new Error("GENERATED_MEDIA_NOT_FOUND");
  }

  const updated = withDesignMediaVoiceBinding(target, mediaId, {
    voiceId: input.voiceId,
    voiceName: input.voiceName,
    voiceBound: Boolean(input.voiceBound && input.voiceId),
  });

  return {
    ...record,
    items: record.items.map((item) =>
      item.id === input.itemId ? updated : item,
    ),
    revision: record.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Guard against applying an older save response after a newer atomic update. */
export function shouldApplySavedDesignRecord(
  incomingRevision: number,
  currentRevision: number,
): boolean {
  return (
    Number.isFinite(incomingRevision) &&
    Number.isFinite(currentRevision) &&
    incomingRevision >= currentRevision
  );
}
