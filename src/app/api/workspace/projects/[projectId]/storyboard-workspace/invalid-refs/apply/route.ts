import { NextResponse } from "next/server";
import { requireWorkspaceProjectAccess } from "@/auth/require-access";
import {
  handleInvalidRefsApply,
} from "@/projects/storyboard/invalid-refs/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  return handleInvalidRefsApply({
    projectId,
    user: gated.user,
    store: "workspace",
    body,
  });
}
