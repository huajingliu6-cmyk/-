import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import {
  runCharacterLookAction,
  type CharacterLookAction,
} from "@/projects/assets/character-look-actions";
import {
  ASSET_REVISION_CONFLICT,
  ASSET_REVISION_REQUIRED,
  isAssetRevisionError,
} from "@/projects/assets/asset-bundle-revision";

type RouteContext = {
  params: Promise<{ projectId: string; characterId: string }>;
};

const ACTIONS = new Set<CharacterLookAction>([
  "set-primary",
  "confirm-main",
  "confirm-appearance",
  "promote-look-to-main",
  "history-to-look",
  "add-look",
  "create-appearance",
  "delete-look",
  "delete-appearance",
  "clear-primary",
  "rename-look",
  "rename-appearance",
  "append-appearance-media",
  "append-main-media",
  "delete-main-history",
]);

function isAction(value: unknown): value is CharacterLookAction {
  return typeof value === "string" && ACTIONS.has(value as CharacterLookAction);
}

const MEDIA_OPTIONAL = new Set<CharacterLookAction>([
  "clear-primary",
  "create-appearance",
  "delete-appearance",
  "rename-appearance",
]);

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId, characterId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const rec =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!rec || !isAction(rec.action)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (!MEDIA_OPTIONAL.has(rec.action) && typeof rec.mediaId !== "string") {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  try {
    return await runCharacterLookAction({
      projectId,
      characterId,
      action: rec.action,
      mediaId: typeof rec.mediaId === "string" ? rec.mediaId : undefined,
      appearanceId:
        typeof rec.appearanceId === "string" ? rec.appearanceId : undefined,
      displayName:
        typeof rec.displayName === "string" ? rec.displayName : undefined,
      promptOverride:
        typeof rec.promptOverride === "string" ? rec.promptOverride : undefined,
      jobId: typeof rec.jobId === "string" ? rec.jobId : undefined,
      store: "workspace",
    });
  } catch (error) {
    if (isAssetRevisionError(error)) {
      return NextResponse.json(
        {
          error: "资产数据已变更，请刷新后重试",
          code:
            error instanceof Error && error.message === ASSET_REVISION_CONFLICT
              ? ASSET_REVISION_CONFLICT
              : ASSET_REVISION_REQUIRED,
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
