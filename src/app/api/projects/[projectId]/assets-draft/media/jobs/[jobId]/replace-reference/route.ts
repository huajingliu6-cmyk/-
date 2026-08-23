import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { serveReplaceImageJobReferences } from "@/projects/assets/image-generation/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string; jobId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, jobId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveReplaceImageJobReferences({
    projectId,
    store: "management",
    jobId,
    request,
  });
}
