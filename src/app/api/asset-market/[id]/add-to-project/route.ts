import { NextResponse } from "next/server";
import { requireMarketAssetPermission } from "@/asset-market/require-market-access";
import { importMaterialToProject } from "@/materials/import-to-project";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  const gated = await requireMarketAssetPermission("market_assets.use");
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  let body: { projectId?: string; characterId?: string | null };
  try {
    body = (await request.json()) as { projectId?: string; characterId?: string | null };
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const projectId = body.projectId?.trim() ?? "";
  if (!projectId) {
    return NextResponse.json({ error: "请选择项目" }, { status: 400 });
  }

  try {
    return await importMaterialToProject({
      userId: gated.user.id,
      materialId: id,
      projectId,
      characterId: body.characterId ?? null,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
