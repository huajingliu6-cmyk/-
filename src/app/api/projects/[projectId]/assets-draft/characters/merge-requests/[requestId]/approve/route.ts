import { NextResponse } from "next/server";
import { requireActualProjectOwner } from "@/auth/require-access";
import { loadCharacterMergeRequests, saveCharacterMergeRequests } from "@/projects/assets/character-merge-requests";
import { mergeCharacters, mergeResultResponse } from "@/projects/assets/merge-characters";

type RouteContext = { params: Promise<{ projectId: string; requestId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { projectId, requestId } = await context.params;
  const gated = await requireActualProjectOwner(projectId);
  if (!gated.ok) return gated.response;
  const file = await loadCharacterMergeRequests(projectId);
  const item = file.requests.find((request) => request.id === requestId);
  if (!item) {
    return NextResponse.json(
      { error: "合并申请不存在", code: "MERGE_REQUEST_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (item.status !== "pending") {
    return NextResponse.json(
      { error: "申请已处理", code: "MERGE_REQUEST_NOT_PENDING" },
      { status: 409 },
    );
  }
  const result = await mergeCharacters({
    projectId,
    targetCharacterId: item.targetCharacterId,
    sourceCharacterId: item.sourceCharacterId,
    scope: "management",
  });
  if (!result.ok) return mergeResultResponse(result);
  await saveCharacterMergeRequests(
    projectId,
    {
      ...file,
      requests: file.requests.map((request) =>
        request.id === requestId
          ? {
              ...request,
              status: "approved",
              decidedAt: new Date().toISOString(),
              decidedByUserId: gated.user.id,
            }
          : request,
      ),
    },
    file.revision,
  );
  return mergeResultResponse(result);
}
