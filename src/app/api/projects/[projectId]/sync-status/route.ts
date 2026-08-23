import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import {
  readProjectSyncStatus,
  retryProjectSync,
} from "@/projects/workspace-sync/sync-status";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  return NextResponse.json(await readProjectSyncStatus(projectId));
}

export async function POST(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  return NextResponse.json(await retryProjectSync(projectId));
}
