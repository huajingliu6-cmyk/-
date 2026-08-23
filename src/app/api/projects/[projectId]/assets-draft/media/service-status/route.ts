import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { probeImageGenerationService } from "@/projects/assets/image-generation/service-status";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const status = await probeImageGenerationService();
  return Response.json({
    online: status.online,
    message: status.message,
    code: status.online ? "SERVICE_ONLINE" : "SERVICE_OFFLINE",
  });
}
