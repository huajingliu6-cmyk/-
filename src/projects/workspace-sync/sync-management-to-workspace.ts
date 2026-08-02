import { createHash } from "crypto";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  loadEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type { EpisodeAssetDesignRecord } from "@/projects/assets/episode-design/types";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { stableHash } from "@/projects/storyboard/hash";
import {
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceSnapshot,
  saveWorkspaceLocalEpisodeDesigns,
  saveWorkspaceSnapshot,
} from "@/projects/workspace-sync/store";
import type { WorkspaceSnapshotEpisode } from "@/projects/workspace-sync/types";

export function computeSourceFingerprint(input: {
  episodes: WorkspaceSnapshotEpisode[];
  assetsUpdatedAt: string | null;
  designsUpdatedAt: string | null;
}): string {
  const episodePayload = input.episodes
    .map((ep) =>
      [
        ep.id,
        String(ep.episodeNumber),
        getScriptEpisodeContentFingerprint({
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          content: ep.content,
        }),
      ].join(":"),
    )
    .join("|");
  return stableHash(
    [episodePayload, input.assetsUpdatedAt ?? "", input.designsUpdatedAt ?? ""].join(
      "\n",
    ),
  );
}

function markLocalDesignsStale(input: {
  localRecords: EpisodeAssetDesignRecord[];
  snapshotEpisodes: WorkspaceSnapshotEpisode[];
}): EpisodeAssetDesignRecord[] {
  const fingerprintByEpisodeId = new Map<string, string>();
  for (const ep of input.snapshotEpisodes) {
    fingerprintByEpisodeId.set(
      ep.id,
      getScriptEpisodeContentFingerprint({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        content: ep.content,
      }),
    );
  }

  return input.localRecords.map((record) => {
    const currentFp = fingerprintByEpisodeId.get(record.episodeId);
    if (!currentFp) return record;
    if (
      record.contentFingerprint &&
      record.contentFingerprint !== currentFp
    ) {
      return { ...record, staleUpstream: true };
    }
    return record;
  });
}

export async function syncManagementToWorkspace(
  projectId: string,
): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  try {
    const [scriptDraft, assetsDraft, designsStore, prevSnapshot, localDesigns] =
      await Promise.all([
        loadScriptDraft(projectId),
        loadAssetBundleDraft(projectId),
        loadEpisodeAssetDesignStore(projectId),
        loadWorkspaceSnapshot(projectId),
        loadWorkspaceLocalEpisodeDesigns(projectId),
      ]);

    const episodes: WorkspaceSnapshotEpisode[] = (scriptDraft?.episodes ?? []).map(
      (ep) => ({
        id: ep.id,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        content: ep.content,
      }),
    );

    const assetsUpdatedAt = assetsDraft?.updatedAt ?? null;
    const designsUpdatedAt = designsStore.updatedAt ?? null;
    const sourceFingerprint = computeSourceFingerprint({
      episodes,
      assetsUpdatedAt,
      designsUpdatedAt,
    });

    const upstreamRevision = (prevSnapshot?.upstreamRevision ?? 0) + 1;
    const assets = assetsDraft ?? {
      projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    };

    const snapshot = {
      projectId,
      upstreamRevision,
      syncedAt: new Date().toISOString(),
      sourceFingerprint,
      episodes,
      assets: {
        projectId: assets.projectId,
        characters: assets.characters,
        scenes: assets.scenes,
        props: assets.props,
        audios: assets.audios,
      },
      episodeAssetDesigns: designsStore,
      syncStatus: "ok" as const,
      syncError: null,
    };

    await saveWorkspaceSnapshot(snapshot);

    if (localDesigns.records.length > 0) {
      const nextRecords = markLocalDesignsStale({
        localRecords: localDesigns.records,
        snapshotEpisodes: episodes,
      });
      const changed = nextRecords.some(
        (rec, idx) => rec.staleUpstream !== localDesigns.records[idx]?.staleUpstream,
      );
      if (changed) {
        await saveWorkspaceLocalEpisodeDesigns({
          ...localDesigns,
          records: nextRecords,
        });
      }
    }

    return { ok: true, revision: upstreamRevision };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "workspace sync failed";
    try {
      const prev = await loadWorkspaceSnapshot(projectId);
      if (prev) {
        await saveWorkspaceSnapshot({
          ...prev,
          syncStatus: "failed",
          syncError: message,
        });
      }
    } catch (statusError) {
      console.error('[workspace-sync] failed to persist sync error', {
        projectId,
        error:
          statusError instanceof Error
            ? statusError.message
            : String(statusError),
      });
    }
    return { ok: false, error: message };
  }
}

/** Legacy helper — hash of management source for diagnostics. */
export function hashManagementSource(
  projectId: string,
  episodes: WorkspaceSnapshotEpisode[],
  assetsUpdatedAt: string | null,
  designsUpdatedAt: string | null,
): string {
  return createHash("sha256")
    .update(
      computeSourceFingerprint({ episodes, assetsUpdatedAt, designsUpdatedAt }),
    )
    .digest("hex");
}

export async function upsertLocalEpisodeRecord(
  projectId: string,
  record: EpisodeAssetDesignRecord,
): Promise<EpisodeAssetDesignRecord> {
  const store = await loadWorkspaceLocalEpisodeDesigns(projectId);
  const nextStore = upsertEpisodeRecord(store, record);
  await saveWorkspaceLocalEpisodeDesigns(nextStore);
  return record;
}
