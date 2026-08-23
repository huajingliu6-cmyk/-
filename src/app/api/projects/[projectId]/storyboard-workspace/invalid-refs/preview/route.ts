import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  handleInvalidRefsPreview,
} from "@/projects/storyboard/invalid-refs/route-handlers";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  return handleInvalidRefsPreview({
    projectId,
    user: session.user,
    store: "management",
    body,
  });
}
