import { requireSessionUser } from "@/auth/require-user";
import {
  handleInvalidRefsScan,
  parseInvalidRefsQuery,
} from "@/projects/storyboard/invalid-refs/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** Workspace：扫描失效引用（资产库 = effective workspace bundle）。 */
export async function GET(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId } = await context.params;
  const parsed = parseInvalidRefsQuery(request);
  if ("error" in parsed) return parsed.error;
  return handleInvalidRefsScan({
    projectId,
    user: session.user,
    store: "workspace",
    scope: parsed.scope,
    episodeId: parsed.episodeId,
    checkBlobs: parsed.checkBlobs,
  });
}
