import {
  loadWorkspaceSnapshot,
} from "@/projects/workspace-sync/store";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { loadEpisodeAssetDesignStore } from "@/projects/assets/episode-design/store";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { computeSourceFingerprint } from "@/projects/workspace-sync/sync-management-to-workspace";

export async function ensureWorkspaceInitialized(
  projectId: string,
): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  const snapshot = await loadWorkspaceSnapshot(projectId);
  if (snapshot) {
    const [scriptDraft, assetsDraft, designsStore] = await Promise.all([
      loadScriptDraft(projectId),
      loadAssetBundleDraft(projectId),
      loadEpisodeAssetDesignStore(projectId),
    ]);
    const episodes = (scriptDraft?.episodes ?? []).map((ep) => ({
      id: ep.id,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      content: ep.content,
    }));
    const sourceFingerprint = computeSourceFingerprint({
      episodes,
      assetsUpdatedAt: assetsDraft?.updatedAt ?? null,
      designsUpdatedAt: designsStore.updatedAt ?? null,
    });
    if (snapshot.sourceFingerprint !== sourceFingerprint) {
      return syncManagementToWorkspace(projectId);
    }
    return { ok: true, revision: snapshot.upstreamRevision };
  }
  return syncManagementToWorkspace(projectId);
}
