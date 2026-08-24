import { NextResponse } from "next/server";
import { getMarketAssetMedia } from "@/asset-market/service";
import { requireMarketAssetPermission } from "@/asset-market/require-market-access";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const gated = await requireMarketAssetPermission("market_assets.use");
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  const payload = await getMarketAssetMedia({ assetId: id });
  if (!payload) {
    return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  }

  const fileName = `${payload.material.name || id}.${payload.media.mime.split("/")[1] ?? "bin"}`;
  return new NextResponse(new Uint8Array(payload.media.body), {
    status: 200,
    headers: {
      "content-type": payload.media.mime,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, no-store",
    },
  });
}
