import { ensureAssetExtractionMigrated } from "@/projects/assets/extraction/migrate";
import { detectExtractionConflicts } from "@/projects/assets/extraction/conflicts";
import {
  mergedAssetsForVersion,
  mergedActiveAssets,
} from "@/projects/assets/extraction/materialize";
import { normalizeExtractedEpisodeIds } from "@/projects/assets/extraction/pipeline/roster";
import { toPublicExtractionTask } from "@/projects/assets/extraction/public-task";
import { resumeLiveAssetExtractionTask } from "@/projects/assets/extraction/resume";
import { annotateRosterForSelection } from "@/projects/assets/extraction/roster-selection";
import { allAssetsTaskKey } from "@/projects/assets/extraction/task-key";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  getActiveVersion,
  getCandidateVersion,
  getLiveTask,
  getOpenOrLatestExtractionTask,
  lastSuccessfulModelKey,
  loadAssetExtractionStore,
} from "@/projects/assets/extraction/store";
import {
  ASSET_EXTRACTION_MISSING_HINT,
  ASSET_EXTRACTION_STAGE_LABELS,
  isAwaitingRosterSelectionStatus,
  isBlockingExtractionStatus,
  isLiveExtractionStatus,
  type ExtractedAsset,
  type ExtractionConflict,
  type PublicAssetExtractionTask,
} from "@/projects/assets/extraction/types";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
} from "@/projects/script/script-draft-store";

export type AssetExtractionSnapshot = {
  fingerprint: string | null;
  hasActiveVersion: boolean;
  fingerprintChanged: boolean;
  lastSuccessfulModelKey: string | null;
  task: PublicAssetExtractionTask | null;
  stageLabel: string | null;
  assets: ExtractedAsset[];
  candidateAssets: ExtractedAsset[];
  conflicts: ExtractionConflict[];
  restartAvailable: boolean;
  restartErrorMessage: string | null;
  extractPromptAvailable: boolean;
  hint: string;
  episodes: Array<{
    episodeId: string;
    episodeNumber: number;
    title: string;
    extracted: boolean;
  }>;
  /** True when this GET re-dispatched a stalled runner. */
  runnerResumed?: boolean;
};

export async function getAssetExtractionSnapshot(
  projectId: string,
): Promise<AssetExtractionSnapshot> {
  await ensureAssetExtractionMigrated(projectId);
  const resume = await resumeLiveAssetExtractionTask(projectId);
  const store = await loadAssetExtractionStore(projectId);
  const draft = await loadScriptDraft(projectId);
  const fingerprint =
    getScriptSourceFingerprint(draft?.sourceText ?? "") ?? null;
  const active = getActiveVersion(store);
  const candidate = getCandidateVersion(store);
  const latest = getOpenOrLatestExtractionTask(store);
  const knownEpisodeIds = (draft?.episodes ?? []).map((episode) => episode.id);
  const assets = mergedActiveAssets(store).map((asset) => ({
    ...asset,
    sourceEpisodeIds: normalizeExtractedEpisodeIds(
      asset.sourceEpisodeIds,
      knownEpisodeIds,
    ),
  }));
  const libraryBundle = await loadAssetBundleDraft(projectId);
  const annotatedRoster =
    latest &&
    isAwaitingRosterSelectionStatus(latest.status) &&
    (latest.roster?.length ?? 0) > 0
      ? annotateRosterForSelection(latest.roster ?? [], {
          extractedAssets: assets,
          libraryBundle,
        })
      : undefined;
  const publicTask = latest
    ? toPublicExtractionTask(latest, { roster: annotatedRoster })
    : null;
  const candidateAssets = candidate
    ? mergedAssetsForVersion(store, candidate.id)
    : [];
  const conflicts =
    active && candidate
      ? detectExtractionConflicts({
          activeAssets: assets,
          candidateAssets,
          overrides: store.overrides.filter(
            (override) => override.versionId === active.id,
          ),
        })
      : [];
  const extractedEpisodeIds = new Set(
    assets.flatMap((asset) => asset.sourceEpisodeIds),
  );
  const live = Boolean(latest && isLiveExtractionStatus(latest.status));
  const blocking = Boolean(
    latest && isBlockingExtractionStatus(latest.status),
  );
  const rosterFailed = Boolean(
    latest &&
      latest.status === "failed" &&
      latest.scope === "all" &&
      (!fingerprint || latest.sourceFingerprint === fingerprint),
  );
  const allAssetsKey = fingerprint
    ? allAssetsTaskKey(projectId, fingerprint)
    : null;
  const allAssetsLive = allAssetsKey
    ? Boolean(getLiveTask(store, allAssetsKey))
    : false;
  return {
    fingerprint,
    hasActiveVersion: Boolean(active),
    fingerprintChanged: Boolean(
      active && fingerprint && active.sourceFingerprint !== fingerprint,
    ),
    lastSuccessfulModelKey: lastSuccessfulModelKey(store),
    task: publicTask,
    stageLabel:
      live && latest ? ASSET_EXTRACTION_STAGE_LABELS[latest.stage] : null,
    assets,
    candidateAssets,
    conflicts,
    restartAvailable: rosterFailed,
    restartErrorMessage: rosterFailed
      ? (latest?.errorMessage ?? "资产名单发现失败")
      : null,
    extractPromptAvailable: Boolean(
      (draft?.episodes.length ?? 0) > 0 &&
        !active &&
        !blocking &&
        !allAssetsLive &&
        !rosterFailed,
    ),
    hint: ASSET_EXTRACTION_MISSING_HINT,
    episodes: (draft?.episodes ?? []).map((episode) => ({
      episodeId: episode.id,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      extracted: extractedEpisodeIds.has(episode.id),
    })),
    runnerResumed: resume.ok ? resume.resumed : false,
  };
}

export async function getAssetExtractionStoreSnapshot(projectId: string) {
  const { loadAssetExtractionStore: load } = await import(
    "@/projects/assets/extraction/store"
  );
  return load(projectId);
}
