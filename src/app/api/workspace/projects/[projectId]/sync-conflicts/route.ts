import { NextResponse } from "next/server";
import { requireWorkspaceProjectAccess } from "@/auth/require-access";
import {
  handleListSyncConflicts,
  handleResolveSyncConflict,
} from "@/projects/workspace-sync/sync-conflicts-http";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  return handleListSyncConflicts(projectId, "workspace");
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  return handleResolveSyncConflict(projectId, "workspace", body);
}
