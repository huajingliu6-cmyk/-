import { NextResponse } from "next/server";
import { addMarketAssetToPersonal } from "@/asset-market/add-to-personal";
import { requireMarketAssetPermission } from "@/asset-market/require-market-access";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Ctx) {
  const gated = await requireMarketAssetPermission("market_assets.use");
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  try {
    const result = await addMarketAssetToPersonal({
      userId: gated.user.id,
      marketAssetId: id,
    });
    return NextResponse.json({
      alreadyAdded: result.alreadyAdded,
      personalAssetId: result.personalAssetId,
      addition: result.addition,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "添加失败";
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
