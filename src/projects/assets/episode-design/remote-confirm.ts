import "server-only";

import { isRemoteRevisionConflict } from "@/persistence/remote-data-client";
import {
  normalizeAssetBundleDraft,
  sanitizeAssetBundleForPersist,
} from "@/projects/assets/asset-bundle-store";
import {
  assetBundleRemoteIdentity,
  loadAssetBundleDraftRemoteDocument,
} from "@/projects/assets/remote-asset-bundle-store";
import {
  transformEpisodeAssetDesignConfirmation,
  type ConfirmEpisodeAssetDesignResult,
} from "@/projects/assets/episode-design/confirm-transform";
import {
  emptyEpisodeAssetDesignStore,
  normalizeEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/store";
import {
  episodeAssetDesignRemoteIdentity,
  loadEpisodeAssetDesignStoreRemoteDocument,
} from "@/projects/assets/episode-design/remote-store";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { runProjectAssetTransaction } from "@/projects/assets/remote-transaction-client";

const MAX_WRITE_ATTEMPTS = 6;

function emptyAssetBundle(projectId: string): ProjectAssetBundle {
  return { projectId, characters: [], scenes: [], props: [], audios: [] };
}

export async function confirmEpisodeAssetDesignRemote(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  userId: string;
  fingerprint: string;
  itemId?: string;
}): Promise<ConfirmEpisodeAssetDesignResult> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const [designDocument, assetDocument] = await Promise.all([
      loadEpisodeAssetDesignStoreRemoteDocument(input.projectId),
      loadAssetBundleDraftRemoteDocument(input.projectId),
    ]);
    const store = designDocument
      ? normalizeEpisodeAssetDesignStore(input.projectId, designDocument.value)
      : emptyEpisodeAssetDesignStore(input.projectId);
    const bundle =
      normalizeAssetBundleDraft(input.projectId, assetDocument?.value) ??
      emptyAssetBundle(input.projectId);
    const transformed = transformEpisodeAssetDesignConfirmation({
      ...input,
      store,
      bundle: sanitizeAssetBundleForPersist(bundle),
    });
    if (!transformed.writeRequired) return transformed.result;

    const designIdentity = episodeAssetDesignRemoteIdentity(input.projectId);
    const assetIdentity = assetBundleRemoteIdentity(input.projectId);
    try {
      await runProjectAssetTransaction({
        writes: [
          {
            namespace: designIdentity.namespace,
            key: designIdentity.key,
            expectedRevision: designDocument?.revision ?? 0,
            value: transformed.nextStore,
          },
          {
            namespace: assetIdentity.namespace,
            key: assetIdentity.key,
            expectedRevision: assetDocument?.revision ?? 0,
            value: transformed.nextBundle,
          },
        ],
      });
    } catch (error) {
      if (isRemoteRevisionConflict(error)) continue;
      wrapWriteFailure(error);
    }

    try {
      const { syncManagementToWorkspace } = await import(
        "@/projects/workspace-sync/sync-management-to-workspace"
      );
      await syncManagementToWorkspace(input.projectId);
    } catch (error) {
      wrapWriteFailure(error);
    }

    return transformed.result;
  }
  return {
    ok: false,
    code: "REVISION_CONFLICT",
    message: "资产设计版本已变更，请刷新后重试",
  };
}
