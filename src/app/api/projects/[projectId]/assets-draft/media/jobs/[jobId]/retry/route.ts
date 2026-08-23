import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { serveRetryImageJob } from "@/projects/assets/image-generation/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string; jobId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { projectId, jobId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveRetryImageJob({
    projectId,
    store: "management",
    jobId,
    actorUserId: gated.user.id,
  });
}
