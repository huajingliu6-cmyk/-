import { requireWorkspaceAssetAccess } from "@/auth/require-access";
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
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return guardAssetRemoteData(() =>
    serveLibraryAssetGet({
      projectId,
      kindParam: kind,
      assetId,
      store: "workspace",
    }),
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const { projectId, kind, assetId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return guardAssetRemoteData(() =>
    serveLibraryAssetDelete({
      request,
      projectId,
      kindParam: kind,
      assetId,
      store: "workspace",
    }),
  );
};
