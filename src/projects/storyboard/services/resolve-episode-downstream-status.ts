import "server-only";

import { getEpisodeDesignRecord, loadEpisodeAssetDesignStore } from "@/projects/assets/episode-design/store";
import { getLiveTask, loadAssetExtractionStore } from "@/projects/assets/extraction/store";
import { isLiveExtractionStatus } from "@/projects/assets/extraction/types";
import {
  resolveEpisodeDownstreamStatus,
  type EpisodeDownstreamStatus,
} from "@/projects/storyboard/episode-downstream-state";
import { loadWorkspace } from "@/projects/storyboard/production-store";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { AssetsSummary } from "@/projects/storyboard/types";

export async function resolveEpisodeDownstreamStatusForProject(input: {
  projectId: string;
  episodeId: string;
  assetsSummary?: AssetsSummary | null;
  assetsDraft?: AssetBundleDraft | null;
}): Promise<EpisodeDownstreamStatus> {
  const workspace = await loadWorkspace(input.projectId);
  const production =
    workspace?.productions.find((p) => p.episodeId === input.episodeId) ?? null;
  const designStore = await loadEpisodeAssetDesignStore(input.projectId);
  const designRecord = getEpisodeDesignRecord(designStore, input.episodeId);

  const extractionStore = await loadAssetExtractionStore(input.projectId);
  const liveTask = getLiveTask(extractionStore);
  const assetsExtracting =
    Boolean(liveTask && isLiveExtractionStatus(liveTask.status)) &&
    (liveTask?.scope === "episode"
      ? liveTask.episodeId === input.episodeId
      : liveTask?.scope === "all");

  const designItems = designRecord?.items ?? [];
  const confirmedItemCount = designItems.filter(
    (item) => Boolean(item.libraryAssetId?.trim()),
  ).length;

  const libraryMatchCount = input.assetsSummary
    ? [
        ...input.assetsSummary.characters,
        ...input.assetsSummary.scenes,
        ...input.assetsSummary.props,
      ].length
    : input.assetsDraft
      ? (input.assetsDraft.characters?.length ?? 0) +
        (input.assetsDraft.scenes?.length ?? 0) +
        (input.assetsDraft.props?.length ?? 0)
      : 0;

  console.info("[storyboard] asset-status", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    designStatus: designRecord?.status ?? null,
    designItemCount: designItems.length,
    confirmedItemCount,
    libraryMatchCount,
    assetsExtracting,
    storyboardStatus: production?.status ?? null,
  });

  const draftEpisode = (await loadScriptDraft(input.projectId))?.episodes.find(
    (episode) => episode.id === input.episodeId,
  );
  const scriptConfirmed = Boolean(
    production?.confirmedScriptText?.trim() ||
      production?.workingScriptText?.trim() ||
      draftEpisode?.content?.trim(),
  );

  return resolveEpisodeDownstreamStatus({
    scriptConfirmed,
    designStatus: designRecord?.status ?? null,
    designItemCount: designItems.length,
    confirmedItemCount,
    libraryMatchCount,
    assetsExtracting,
    storyboardStatus: production?.status ?? null,
    hasStoryboard: Boolean(production?.activeStoryboard),
    generationError: production?.generationError ?? null,
  });
}
