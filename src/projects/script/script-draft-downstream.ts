import 'server-only';

import { isRemoteDataOnly } from '@/persistence/remote-data-client';
import { syncManagementToWorkspace } from '@/projects/workspace-sync/sync-management-to-workspace';

export async function synchronizeScriptDraftDownstream(input: {
  projectId: string;
  contentChanged: boolean;
  syncWhenUnchanged?: boolean;
}): Promise<{ deferred: boolean }> {
  const remoteOnly = isRemoteDataOnly();
  if (input.contentChanged || input.syncWhenUnchanged) {
    await syncManagementToWorkspace(input.projectId);
  }
  return { deferred: remoteOnly };
}
