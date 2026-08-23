import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import {
  serveGetImageJob,
  serveImageJobAction,
} from "@/projects/assets/image-generation/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string; jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, jobId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveGetImageJob({ projectId, store: "workspace", jobId });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, jobId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  let body: { action?: string; saveErrorMessage?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "无效请求" }, { status: 400 });
  }
  const action = body.action;
  if (
    action !== "extend-wait" &&
    action !== "mark-timed-out" &&
    action !== "fail-after-wait" &&
    action !== "mark-saved" &&
    action !== "mark-save-failed" &&
    action !== "delete-pending" &&
    action !== "retry-save"
  ) {
    return Response.json({ error: "无效操作" }, { status: 400 });
  }
  return serveImageJobAction({
    projectId,
    store: "workspace",
    jobId,
    action,
    saveErrorMessage: body.saveErrorMessage,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId, jobId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  return serveImageJobAction({
    projectId,
    store: "workspace",
    jobId,
    action: "delete-pending",
  });
}
