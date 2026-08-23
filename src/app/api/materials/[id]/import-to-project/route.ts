import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { importMaterialToProject } from "@/materials/import-to-project";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "请选择项目" }, { status: 400 });
  }
  const characterId =
    typeof body.characterId === "string" ? body.characterId.trim() : null;

  try {
    return await importMaterialToProject({
      userId: gated.user.id,
      materialId: id,
      projectId,
      characterId,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "导入失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
