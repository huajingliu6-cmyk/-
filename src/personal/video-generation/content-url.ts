import type { PersonalVideoHistoryItem } from "@/personal/video-generation/types";
import { buildGeneratedVideoContentUrl } from "@/workflow/lib/generated-video-url";
import type { GenerationRecord } from "@/video-generation/types";

const LEGACY_GENERATED_VIDEO_URL = /^\/api\/generated-videos\/([^/?#]+)/;

function personalVideoProjectId(userId: string): string {
  return `personal-${userId}`;
}

function resolvePersonalVideoAssetId(record: GenerationRecord): string | null {
  if (record.localVideoAssetId) return record.localVideoAssetId;
  if (record.resultAsset?.assetType === "generatedVideo") {
    return record.resultAsset.id;
  }
  return null;
}

export function personalVideoContentUrlFromRecord(
  record: GenerationRecord,
): string | null {
  const assetId = resolvePersonalVideoAssetId(record);
  if (!assetId) return null;
  return buildGeneratedVideoContentUrl({
    assetId,
    generationId: record.id,
    projectId: record.projectId,
  });
}

export function repairLegacyPersonalVideoUrl(
  item: PersonalVideoHistoryItem,
  userId: string,
): string | null {
  if (!item.videoUrl) return null;
  const match = item.videoUrl.match(LEGACY_GENERATED_VIDEO_URL);
  if (!match) return item.videoUrl;
  const assetId = decodeURIComponent(match[1] ?? "");
  if (!assetId) return null;
  return buildGeneratedVideoContentUrl({
    assetId,
    generationId: item.generationId,
    projectId: personalVideoProjectId(userId),
  });
}
