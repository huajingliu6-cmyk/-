import { SYNC_DEPENDENCY_BLOCKED } from "@/projects/workspace-sync/sync-model";
import { readProjectSyncStatus } from "@/projects/workspace-sync/sync-status";
import {
  actionDependsOnSync,
  type SyncAction,
  type ProjectSyncItem,
} from "@/projects/workspace-sync/sync-model";

export function blockingSyncItem(
  action: SyncAction,
  items: ProjectSyncItem[],
  entityId?: string | null,
): ProjectSyncItem | null {
  for (const item of items) {
    if (!actionDependsOnSync(action, item)) continue;
    if (entityId && item.entityId && item.entityId !== entityId) {
      continue;
    }
    if (item.syncStatus === "conflict") {
      if (!entityId || !item.entityId || item.entityId !== entityId) {
        continue;
      }
    }
    return item;
  }
  return null;
}

export class SyncDependencyBlockedError extends Error {
  readonly code = SYNC_DEPENDENCY_BLOCKED;
  constructor(message: string) {
    super(message);
    this.name = SYNC_DEPENDENCY_BLOCKED;
  }
}

export async function assertSyncActionAllowed(input: {
  projectId: string;
  action: SyncAction;
  entityId?: string | null;
}): Promise<void> {
  if (
    input.action === "browse" ||
    input.action === "edit-script" ||
    input.action === "view-storyboard" ||
    input.action === "view-generated-media" ||
    input.action === "edit-shot"
  ) {
    return;
  }
  const status = await readProjectSyncStatus(input.projectId);
  const blocked = blockingSyncItem(input.action, status.items, input.entityId);
  if (!blocked) return;
  throw new SyncDependencyBlockedError(
    `操作依赖未完成的同步（${blocked.scope}）`,
  );
}

export async function isSyncActionAllowed(input: {
  projectId: string;
  action: SyncAction;
  entityId?: string | null;
}): Promise<boolean> {
  try {
    await assertSyncActionAllowed(input);
    return true;
  } catch (error) {
    if (error instanceof SyncDependencyBlockedError) return false;
    throw error;
  }
}
