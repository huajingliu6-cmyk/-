import { NextResponse } from "next/server";
import {
  listSyncConflicts,
  resolveSyncConflict,
  SYNC_CONFLICT_STALE,
  type ConflictResolutionChoice,
  type OperationStoreKind,
} from "@/projects/workspace-sync/conflict-resolution";
import { CONFLICT_RESOLUTION_TYPE } from "@/projects/workspace-sync/sync-model";
import type { ProjectAssetType } from "@/projects/assets/types";
import {
  isOperationFailedError,
  operationFailedResponse,
} from "@/projects/operation-failed";

const ENTITY_TYPES = new Set(["character", "scene", "prop", "audio"]);
const CHOICES = new Set(["management", "workspace", "manual"]);

export async function handleListSyncConflicts(
  projectId: string,
  store: OperationStoreKind,
): Promise<NextResponse> {
  return NextResponse.json(await listSyncConflicts(projectId, store));
}

export async function handleResolveSyncConflict(
  projectId: string,
  store: OperationStoreKind,
  body: unknown,
): Promise<NextResponse> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  const entityType = rec.entityType;
  const entityId = rec.entityId;
  const field = rec.field;
  const choice = rec.choice;
  if (
    typeof entityType !== "string" ||
    !ENTITY_TYPES.has(entityType) ||
    typeof entityId !== "string" ||
    !entityId.trim() ||
    typeof field !== "string" ||
    !field.trim() ||
    typeof choice !== "string" ||
    !CHOICES.has(choice)
  ) {
    return NextResponse.json({ error: "冲突解决参数不完整" }, { status: 400 });
  }
  try {
    const result = await resolveSyncConflict({
      projectId,
      store,
      entityType: entityType as ProjectAssetType,
      entityId: entityId.trim(),
      field: field.trim(),
      choice: choice as ConflictResolutionChoice,
      value: rec.value,
    });
    return NextResponse.json({
      ...result,
      operationType: CONFLICT_RESOLUTION_TYPE,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "INVALID_CONFLICT_VALUE") {
      return NextResponse.json(
        { error: error.message, code: "INVALID_CONFLICT_VALUE" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.name === SYNC_CONFLICT_STALE) {
      return NextResponse.json(
        { error: error.message, code: SYNC_CONFLICT_STALE },
        { status: 409 },
      );
    }
    if (isOperationFailedError(error)) {
      return operationFailedResponse();
    }
    throw error;
  }
}
