import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import {
  serveLibraryAssetDelete,
  serveLibraryAssetGet,
} from "@/projects/assets/library-asset-delete-route-handlers";
import { guardAssetRemoteData } from "@/projects/assets/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; kind: string; assetId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, kind, assetId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const result = await guardAssetRemoteData(() =>
    serveLibraryAssetGet({
      projectId,
      kindParam: kind,
      assetId,
      store: "management",
    }),
  );
  return result;
}

export async function DELETE(request: Request, context: RouteContext) {
  const { projectId, kind, assetId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const result = await guardAssetRemoteData(() =>
    serveLibraryAssetDelete({
      request,
      projectId,
      kindParam: kind,
      assetId,
      store: "management",
    }),
  );
  return result;
};
