import { NextResponse } from "next/server";
import { parseMarketAssetListQuery } from "@/asset-market/parse-list-query";
import { requireMarketAssetPermission } from "@/asset-market/require-market-access";
import { listMarketAssetsForUser } from "@/asset-market/service";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET(request: Request) {
  const gated = await requireMarketAssetPermission("market_assets.read");
  if (!gated.ok) return gated.response;

  const { searchParams } = new URL(request.url);
  const query = parseMarketAssetListQuery(searchParams);

  try {
    const result = await listMarketAssetsForUser({
      userId: gated.user.id,
      query,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
