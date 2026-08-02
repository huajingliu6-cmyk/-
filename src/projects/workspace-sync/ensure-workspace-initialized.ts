import {
  loadWorkspaceSnapshot,
} from "@/projects/workspace-sync/store";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";

export async function ensureWorkspaceInitialized(
  projectId: string,
): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  const snapshot = await loadWorkspaceSnapshot(projectId);
  if (snapshot) {
    return { ok: true, revision: snapshot.upstreamRevision };
  }
  return syncManagementToWorkspace(projectId);
}
