import 'server-only';

import { isRemoteDataOnly } from '@/persistence/remote-data-client';
import type { AssetBundleDraft } from '@/projects/assets/asset-bundle-store';
import { syncChangedCharacterVoicesFromBundle } from '@/projects/assets/sync-character-voice';
import { syncManagementToWorkspace } from '@/projects/workspace-sync/sync-management-to-workspace';

export async function synchronizeAssetDraftDownstream(input: {
  projectId: string;
  previous: AssetBundleDraft | null;
  next: AssetBundleDraft;
}): Promise<{ deferred: boolean }> {
  const remoteOnly = isRemoteDataOnly();
  try {
    await syncChangedCharacterVoicesFromBundle(input);
  } catch (error) {
    console.error('[character-voice-sync] asset draft sync failed', {
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const syncResult = await syncManagementToWorkspace(input.projectId);
  if (!syncResult.ok) {
    console.error('[workspace-sync] management to workspace sync failed', {
      projectId: input.projectId,
      error: syncResult.error,
    });
  }
  return { deferred: remoteOnly };
}

export async function synchronizeAssetMediaDownstream(
  projectId: string,
): Promise<{ deferred: boolean }> {
  const remoteOnly = isRemoteDataOnly();
  const syncResult = await syncManagementToWorkspace(projectId);
  if (!syncResult.ok) {
    console.error('[workspace-sync] asset media sync failed', {
      projectId,
      error: syncResult.error,
    });
  }
  return { deferred: remoteOnly };
}
