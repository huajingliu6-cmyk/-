import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  getProjectAssetImageUrl,
  resolveAssetImageSrc,
} from "@/projects/assets/asset-image-url";

/**
 * Design items that have been promoted into the formal library
 * (workspace approval or management confirm). Workspace clients must not
 * remove these; only project management (owner) may delete them.
 */
export function isApprovedEpisodeDesignItem(
  item: Pick<
    EpisodeAssetDesignItem,
    "libraryAssetId" | "generatedMedia"
  >,
): boolean {
  if (typeof item.libraryAssetId === "string" && item.libraryAssetId.trim()) {
    return true;
  }
  const approvedIds = item.generatedMedia?.approvedIds;
  return Array.isArray(approvedIds) && approvedIds.length > 0;
}

/**
 * After approval, designers cannot change character voice on design cards.
 * Server merge keeps the previously approved voice fields.
 */
export function preserveApprovedCharacterVoice(
  serverItem: EpisodeAssetDesignItem | undefined,
  clientItem: EpisodeAssetDesignItem,
): EpisodeAssetDesignItem {
  if (
    !serverItem ||
    serverItem.assetType !== "character" ||
    clientItem.assetType !== "character" ||
    !isApprovedEpisodeDesignItem(serverItem)
  ) {
    return clientItem;
  }
  return {
    ...clientItem,
    draft: {
      ...clientItem.draft,
      voiceId: serverItem.draft.voiceId,
      voiceName: serverItem.draft.voiceName,
      voiceBound: serverItem.draft.voiceBound || Boolean(serverItem.draft.voiceId),
    },
  };
}

export function findRemovedApprovedDesignItems(
  previousItems: EpisodeAssetDesignItem[],
  nextItems: EpisodeAssetDesignItem[],
): EpisodeAssetDesignItem[] {
  const nextIds = new Set(nextItems.map((item) => item.id));
  return previousItems.filter(
    (item) => isApprovedEpisodeDesignItem(item) && !nextIds.has(item.id),
  );
}

export type DesignCardApprovalUi = "none" | "pending" | "approved";

/**
 * Card chrome for the currently displayed generated image.
 * Pending (submitted, not yet owner-approved) wins over approved.
 */
export function designCardApprovalUi(
  item: Pick<EpisodeAssetDesignItem, "libraryAssetId" | "generatedMedia">,
  pendingMediaIds: ReadonlySet<string>,
  approvedMediaIds: ReadonlySet<string> = new Set(),
): DesignCardApprovalUi {
  const currentId = item.generatedMedia?.currentId?.trim() ?? "";
  if (currentId && pendingMediaIds.has(currentId)) return "pending";
  if (currentId && approvedMediaIds.has(currentId)) return "approved";
  if (
    currentId &&
    Array.isArray(item.generatedMedia?.approvedIds) &&
    item.generatedMedia.approvedIds.includes(currentId)
  ) {
    return "approved";
  }
  if (isApprovedEpisodeDesignItem(item)) return "approved";
  return "none";
}

type LibraryImageAsset = {
  id: string;
  imageFileName: string | null;
  imageObjectUrl: string | null;
  primaryMediaId?: string | null;
  approvedMediaIds?: string[];
};

/**
 * Resolve a durable preview URL for design cards.
 * Do not require previewKind === "image" (older/promoted rows often omit it).
 * Fall back to library asset image when design media is missing.
 */
export function resolveDesignItemPreviewUrl(
  projectId: string,
  item: Pick<
    EpisodeAssetDesignItem,
    "assetType" | "libraryAssetId" | "generatedMedia"
  >,
  library?: {
    characters: LibraryImageAsset[];
    scenes: LibraryImageAsset[];
    props: LibraryImageAsset[];
  },
): string | null {
  if (item.assetType === "audio") return null;
  const media = item.generatedMedia;
  if (media?.previewKind === "audio") return null;

  const candidates: string[] = [];
  const push = (raw: string | null | undefined) => {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id && !candidates.includes(id)) candidates.push(id);
  };
  push(media?.currentId);
  if (Array.isArray(media?.historyIds)) {
    for (let i = media.historyIds.length - 1; i >= 0; i -= 1) {
      push(media.historyIds[i]);
    }
  }
  if (Array.isArray(media?.approvedIds)) {
    for (const id of media.approvedIds) push(id);
  }
  if (Array.isArray(media?.history)) {
    for (let i = media.history.length - 1; i >= 0; i -= 1) {
      push(media.history[i]?.mediaId);
    }
  }
  if (candidates.length > 0) {
    return getProjectAssetImageUrl(projectId, candidates[0]!);
  }

  const libId = item.libraryAssetId?.trim();
  if (!libId || !library) return null;
  const list =
    item.assetType === "character"
      ? library.characters
      : item.assetType === "scene"
        ? library.scenes
        : library.props;
  const asset = list.find((a) => a.id === libId);
  if (!asset) return null;
  return resolveAssetImageSrc(projectId, {
    id: asset.id,
    imageFileName: asset.imageFileName,
    imageObjectUrl: asset.imageObjectUrl,
    primaryMediaId: asset.primaryMediaId,
    approvedMediaIds: asset.approvedMediaIds,
  });
}
