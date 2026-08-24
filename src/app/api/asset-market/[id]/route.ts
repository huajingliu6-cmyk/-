import { NextResponse } from "next/server";
import { requireMarketAssetPermission } from "@/asset-market/require-market-access";
import { getMarketAssetForUser } from "@/asset-market/service";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const gated = await requireMarketAssetPermission("market_assets.read");
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  try {
    const item = await getMarketAssetForUser({
      userId: gated.user.id,
      assetId: id,
    });
    if (!item) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
