import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { runCharacterReplacePrimary } from "@/projects/assets/character-media-actions";

type RouteContext = {
  params: Promise<{ projectId: string; characterId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, characterId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const file = form.get("file");
  const commitRaw = form.get("commit");
  return runCharacterReplacePrimary({
    projectId,
    characterId,
    file: file instanceof File ? file : null,
    commit: typeof commitRaw === "string" ? commitRaw : null,
    mediaId:
      typeof form.get("mediaId") === "string"
        ? String(form.get("mediaId"))
        : null,
    store: "workspace",
  });
}
