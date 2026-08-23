import "server-only";

import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { syncChangedCharacterVoicesFromBundle } from "@/projects/assets/sync-character-voice";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";

export async function synchronizeAssetDraftDownstream(input: {
  projectId: string;
  previous: AssetBundleDraft | null;
  next: AssetBundleDraft;
}): Promise<{ deferred: boolean }> {
  const remoteOnly = isRemoteDataOnly();
  try {
    await syncChangedCharacterVoicesFromBundle(input);
  } catch (error) {
    console.error("[character-voice-sync] asset draft sync failed", {
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await syncManagementToWorkspace(input.projectId);
  return { deferred: remoteOnly };
}

export async function synchronizeAssetMediaDownstream(
  projectId: string,
): Promise<{ deferred: boolean }> {
  const remoteOnly = isRemoteDataOnly();
  await syncManagementToWorkspace(projectId);
  return { deferred: remoteOnly };
}
