import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { serveListImageJobs } from "@/projects/assets/image-generation/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const url = new URL(request.url);
  return serveListImageJobs({
    projectId,
    store: "management",
    assetId: url.searchParams.get("assetId"),
    assetKind: url.searchParams.get("assetKind"),
    sourceEntry: url.searchParams.get("sourceEntry"),
  });
}
