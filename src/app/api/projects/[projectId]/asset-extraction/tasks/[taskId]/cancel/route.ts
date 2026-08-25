import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { handleCancelAssetExtraction } from "@/projects/assets/extraction/http";
import { guardAssetRemoteData } from "@/projects/assets/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; taskId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { projectId, taskId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const guardedProject = await guardAssetRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  if (!guardedProject) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const guarded = await guardAssetRemoteData(() =>
    handleCancelAssetExtraction(projectId, taskId),
  );
  if (guarded instanceof NextResponse) return guarded;
  return guarded;
}
