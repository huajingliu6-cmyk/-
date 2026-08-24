import { NextResponse } from "next/server";
import { addMarketAssetToCanvas } from "@/asset-market/add-to-canvas";
import { isMarketAssetCategory } from "@/asset-market/map-material";
import { requireVideoCanvasAccess } from "@/auth/require-access";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireVideoCanvasAccess(projectId);
  if (!gated.ok) return gated.response;

  let body: {
    marketAssetId?: string;
    category?: string;
    position?: { x?: number; y?: number };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const marketAssetId = body.marketAssetId?.trim() ?? "";
  if (!marketAssetId) {
    return NextResponse.json({ error: "缺少 marketAssetId" }, { status: 400 });
  }
  if (!isMarketAssetCategory(body.category)) {
    return NextResponse.json({ error: "素材分类无效" }, { status: 400 });
  }

  const position =
    body.position &&
    typeof body.position.x === "number" &&
    typeof body.position.y === "number"
      ? { x: body.position.x, y: body.position.y }
      : null;

  try {
    const result = await addMarketAssetToCanvas({
      projectId,
      marketAssetId,
      category: body.category,
      position,
    });
    return NextResponse.json({
      ok: true,
      assetId: result.asset.id,
      nodeId: result.node.id,
      workflowRevision: result.workflow.version,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "添加到画布失败";
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
