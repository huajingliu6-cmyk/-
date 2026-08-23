import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import {
  resolveProjectAssetImageCacheHeaders,
  serveProjectAssetImageDelete,
  serveProjectAssetImageGet,
  serveProjectAssetImagePut,
} from "@/projects/assets/asset-image-route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveProjectAssetImageGet({
    request,
    projectId,
    assetId,
    store: "workspace",
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveProjectAssetImagePut({
    request,
    projectId,
    assetId,
    store: "workspace",
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveProjectAssetImageDelete({
    projectId,
    assetId,
    store: "workspace",
  });
}
