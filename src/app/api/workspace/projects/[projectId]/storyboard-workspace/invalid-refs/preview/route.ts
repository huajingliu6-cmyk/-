import { NextResponse } from "next/server";
import { requireWorkspaceProjectAccess } from "@/auth/require-access";
import {
  handleInvalidRefsPreview,
} from "@/projects/storyboard/invalid-refs/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const gated = await requireWorkspaceProjectAccess(
    (await context.params).projectId,
  );
  if (!gated.ok) return gated.response;
  const { projectId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  return handleInvalidRefsPreview({
    projectId,
    user: gated.user,
    store: "workspace",
    body,
  });
}
