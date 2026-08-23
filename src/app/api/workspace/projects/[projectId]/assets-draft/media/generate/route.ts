import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { runLibraryAssetMediaGenerate } from "@/projects/assets/library-asset-media";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return runLibraryAssetMediaGenerate({
    request,
    projectId,
    actorUserId: gated.user.id,
    store: "workspace",
  });
}
