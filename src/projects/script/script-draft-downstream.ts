import 'server-only';

import { isRemoteDataOnly } from '@/persistence/remote-data-client';
import { invalidateWorkspaceAfterScriptDraftChange } from '@/projects/script/script-draft-invalidation';
import { syncManagementToWorkspace } from '@/projects/workspace-sync/sync-management-to-workspace';

export async function synchronizeScriptDraftDownstream(input: {
  projectId: string;
  contentChanged: boolean;
  syncWhenUnchanged?: boolean;
}): Promise<{ deferred: boolean }> {
  const remoteOnly = isRemoteDataOnly();
  if (input.contentChanged && !remoteOnly) {
    await invalidateWorkspaceAfterScriptDraftChange(input.projectId);
  }
  if (input.contentChanged || input.syncWhenUnchanged) {
    const result = await syncManagementToWorkspace(input.projectId);
    if (!result.ok) {
      console.error('[workspace-sync] management to workspace sync failed', {
        projectId: input.projectId,
        code: result.error,
      });
    }
  }
  return { deferred: remoteOnly };
}
