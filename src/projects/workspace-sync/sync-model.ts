export const WORKSPACE_DOWNSTREAM_SYNC_TYPE = "workspace-downstream-sync";
export const SCRIPT_PRODUCTION_INVALIDATE_TYPE = "script-production-invalidate";
export const SCRIPT_PROMPT_REFRESH_TYPE = "script-prompt-refresh";
export const BIDIRECTIONAL_MERGE_TYPE = "workspace-bidirectional-merge";
export const MEDIA_METADATA_SYNC_TYPE = "media-metadata-sync";
export const CONFLICT_RESOLUTION_TYPE = "workspace-conflict-resolution";
export const SYNC_DEPENDENCY_BLOCKED = "SYNC_DEPENDENCY_BLOCKED";

export type SyncLifecycle =
  | "pending"
  | "failed"
  | "unknown"
  | "conflict"
  | "committed"
  | "ok";

export type SyncKind =
  | typeof WORKSPACE_DOWNSTREAM_SYNC_TYPE
  | typeof SCRIPT_PRODUCTION_INVALIDATE_TYPE
  | typeof SCRIPT_PROMPT_REFRESH_TYPE
  | typeof BIDIRECTIONAL_MERGE_TYPE
  | typeof MEDIA_METADATA_SYNC_TYPE
  | typeof CONFLICT_RESOLUTION_TYPE;

export type SyncAction =
  | "browse"
  | "edit-script"
  | "edit-management-assets"
  | "edit-workspace-assets"
  | "edit-shot"
  | "view-storyboard"
  | "view-generated-media"
  | "generate-storyboard"
  | "generate-shot-video"
  | "regenerate-shot-prompt"
  | "confirm-episode-design"
  | "promote-asset"
  | "use-asset-media";

export type SyncConflictRecord = {
  entityType: "character" | "scene" | "prop" | "audio";
  entityId: string;
  field: string;
  baseValue: unknown;
  managementValue: unknown;
  workspaceValue: unknown;
  managementRevision: number;
  workspaceRevision: number;
  operationId: string;
  status?: "open" | "resolved";
  resolvedBy?: "management" | "workspace" | "manual" | null;
  resolvedValue?: unknown;
  resolutionOperationId?: string | null;
  resolvedAt?: string | null;
};

export type ProjectSyncItem = {
  kind: SyncKind | string;
  syncStatus: SyncLifecycle;
  sourceStore: "management" | "workspace" | "shared";
  targetStore: "management" | "workspace" | "shared";
  scope: string;
  reason: string | null;
  operationId: string | null;
  parentOperationId: string | null;
  statusUrl: string | null;
  retryPath: string;
  entityId?: string | null;
  entityType?: string | null;
  conflicts?: SyncConflictRecord[];
};

export type ProjectSyncStatus = {
  syncStatus: SyncLifecycle;
  syncError: string | null;
  operationId: string | null;
  parentOperationId: string | null;
  sourceManagementRevision: number | null;
  retryPath: string;
  items: ProjectSyncItem[];
};

export const HELD_CHILD_TYPES: readonly string[] = [
  WORKSPACE_DOWNSTREAM_SYNC_TYPE,
  SCRIPT_PRODUCTION_INVALIDATE_TYPE,
  SCRIPT_PROMPT_REFRESH_TYPE,
  BIDIRECTIONAL_MERGE_TYPE,
  MEDIA_METADATA_SYNC_TYPE,
];

export function isHeldSyncChildType(operationType: string): boolean {
  return HELD_CHILD_TYPES.includes(operationType);
}

/** Actions that may proceed while a given sync kind is pending/failed/conflict. */
export function actionDependsOnSync(
  action: SyncAction,
  item: Pick<ProjectSyncItem, "kind" | "entityId" | "syncStatus">,
): boolean {
  if (item.syncStatus === "ok" || item.syncStatus === "committed") return false;
  switch (action) {
    case "browse":
    case "edit-script":
    case "view-storyboard":
    case "view-generated-media":
    case "edit-shot":
      return false;
    case "edit-management-assets":
    case "edit-workspace-assets":
      return (
        item.kind === BIDIRECTIONAL_MERGE_TYPE &&
        item.syncStatus === "conflict"
      );
    case "generate-storyboard":
    case "generate-shot-video":
    case "regenerate-shot-prompt":
      return (
        item.kind === SCRIPT_PRODUCTION_INVALIDATE_TYPE ||
        item.kind === SCRIPT_PROMPT_REFRESH_TYPE
      );
    case "confirm-episode-design":
      return item.kind === WORKSPACE_DOWNSTREAM_SYNC_TYPE;
    case "promote-asset":
      return (
        item.kind === BIDIRECTIONAL_MERGE_TYPE ||
        item.kind === MEDIA_METADATA_SYNC_TYPE
      );
    case "use-asset-media":
      return item.kind === MEDIA_METADATA_SYNC_TYPE;
    default:
      return false;
  }
}
