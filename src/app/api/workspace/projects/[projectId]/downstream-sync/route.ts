import { NextResponse } from "next/server";
import { requireWorkspaceProjectAccess } from "@/auth/require-access";
import {
  getWorkspaceDownstreamSyncStatus,
  syncManagementToWorkspace,
} from "@/projects/workspace-sync/sync-management-to-workspace";
import {
  isOperationFailedError,
  operationFailedResponse,
} from "@/projects/operation-failed";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const status = await getWorkspaceDownstreamSyncStatus(projectId);
  return NextResponse.json(status);
}

export async function POST(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  try {
    const result = await syncManagementToWorkspace(projectId);
    const status = await getWorkspaceDownstreamSyncStatus(projectId);
    return NextResponse.json({
      ...status,
      revision: result.revision,
      operationId: result.operationId ?? status.operationId,
    });
  } catch (error) {
    if (isOperationFailedError(error)) return operationFailedResponse();
    throw error;
  }
}
