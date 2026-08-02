import { randomUUID } from "crypto";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";
import {
  dtoItemsToDesignItems,
  matchExistingAssets,
} from "@/projects/assets/episode-design/match";
import { mergeGeneratedMediaState } from "@/projects/assets/episode-design/generated-media-history";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";

function preserveMediaFromPreviousItems(
  nextItems: EpisodeAssetDesignItem[],
  previousItems: EpisodeAssetDesignItem[],
): EpisodeAssetDesignItem[] {
  if (previousItems.length === 0) return nextItems;
  const usedPrev = new Set<string>();
  return nextItems.map((item) => {
    const prev =
      previousItems.find(
        (p) =>
          !usedPrev.has(p.id) &&
          p.assetType === item.assetType &&
          p.name.trim() === item.name.trim() &&
          (p.generatedMedia?.historyIds?.length ?? 0) > 0,
      ) ??
      previousItems.find(
        (p) =>
          !usedPrev.has(p.id) &&
          p.assetType === item.assetType &&
          p.name.trim() === item.name.trim(),
      );
    if (!prev) return item;
    usedPrev.add(prev.id);
    const mergedMedia = mergeGeneratedMediaState(
      prev.generatedMedia,
      item.generatedMedia,
    );
    return mergedMedia ? { ...item, generatedMedia: mergedMedia } : item;
  });
}

export function applyParsedDesignToEpisodeRecord(input: {
  record: EpisodeAssetDesignRecord;
  parsed: EpisodeAssetDesignGenerationDto;
  bundle: Pick<
    ProjectAssetBundle,
    "characters" | "scenes" | "props" | "audios"
  >;
  contentFingerprint: string;
  generationId: string;
  designConversation?: EpisodeDesignConversationMessage[];
}): EpisodeAssetDesignRecord {
  const rawItems = dtoItemsToDesignItems(input.parsed);
  const withIds = rawItems.map((item) => ({
    ...item,
    id: randomUUID(),
  }));
  const matched = matchExistingAssets(withIds, input.bundle);
  const withPreservedMedia = preserveMediaFromPreviousItems(
    matched,
    input.record.items,
  );
  const now = new Date().toISOString();
  return {
    ...input.record,
    status: "review",
    revision: input.record.revision + 1,
    contentFingerprint: input.contentFingerprint,
    generationId: input.generationId,
    items: withPreservedMedia,
    ...(input.designConversation
      ? { designConversation: input.designConversation }
      : {}),
    updatedAt: now,
  };
}
