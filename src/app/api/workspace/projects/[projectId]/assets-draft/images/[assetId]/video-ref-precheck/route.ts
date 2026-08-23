import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { runLibraryAssetSd2Precheck } from "@/projects/assets/library-asset-sd2-precheck";
import {
  isOperationFailedError,
  operationFailedResponse,
} from "@/projects/operation-failed";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const mediaId = typeof raw?.mediaId === "string" ? raw.mediaId : null;

  try {
    return await runLibraryAssetSd2Precheck({
      projectId,
      assetId,
      mediaId,
      store: "workspace",
    });
  } catch (error) {
    if (isOperationFailedError(error)) return operationFailedResponse();
    throw error;
  }
}
