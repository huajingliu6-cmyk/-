import { NextResponse } from "next/server";
import { requireActualProjectOwner } from "@/auth/require-access";
import { mergeCharacters, mergeResultResponse } from "@/projects/assets/merge-characters";
import { loadCharacterMergeRequests } from "@/projects/assets/character-merge-requests";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireActualProjectOwner(projectId);
  if (!gated.ok) return gated.response;
  const file = await loadCharacterMergeRequests(projectId);
  return NextResponse.json({ requests: file.requests });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireActualProjectOwner(projectId);
  if (!gated.ok) return gated.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;
  if (
    typeof rec.targetCharacterId !== "string" ||
    typeof rec.sourceCharacterId !== "string"
  ) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const result = await mergeCharacters({
    projectId,
    targetCharacterId: rec.targetCharacterId,
    sourceCharacterId: rec.sourceCharacterId,
    scope: "management",
  });
  return mergeResultResponse(result);
}
