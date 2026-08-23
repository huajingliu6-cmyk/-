import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { mergeCharacters, mergeResultResponse } from "@/projects/assets/merge-characters";
import {
  loadCharacterMergeRequests,
  saveCharacterMergeRequests,
  newMergeRequestId,
} from "@/projects/assets/character-merge-requests";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;
  if (gated.access.role !== "PROJECT_OWNER" && gated.access.role !== "SYSTEM_ADMIN") {
    return NextResponse.json({ error: "仅项目主理人可查看合并申请" }, { status: 403 });
  }
  const file = await loadCharacterMergeRequests(projectId);
  return NextResponse.json({ requests: file.requests });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
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
  if (gated.access.role === "PROJECT_OWNER" || gated.access.role === "SYSTEM_ADMIN") {
    const result = await mergeCharacters({
      projectId,
      targetCharacterId: rec.targetCharacterId,
      sourceCharacterId: rec.sourceCharacterId,
      scope: "workspace",
    });
    return mergeResultResponse(result);
  }
  const file = await loadCharacterMergeRequests(projectId);
  const requestItem = {
    id: newMergeRequestId(),
    projectId,
    targetCharacterId: rec.targetCharacterId,
    sourceCharacterId: rec.sourceCharacterId,
    submittedByUserId: gated.user.id,
    status: "pending" as const,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedByUserId: null,
  };
  await saveCharacterMergeRequests(projectId, {
    ...file,
    requests: [...file.requests, requestItem],
  }, file.revision);
  return NextResponse.json({ submitted: true, request: requestItem });
}
