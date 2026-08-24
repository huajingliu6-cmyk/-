import { NextResponse } from "next/server";
import { getMarketAssetMedia } from "@/asset-market/service";
import { requireMarketAssetPermission } from "@/asset-market/require-market-access";

type Ctx = { params: Promise<{ id: string }> };

async function serveImage(
  request: Request,
  context: Ctx,
  mode: "thumbnail" | "preview" | "download",
) {
  const gated = await requireMarketAssetPermission(
    mode === "download" ? "market_assets.use" : "market_assets.read",
  );
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  const payload = await getMarketAssetMedia({ assetId: id });
  if (!payload) {
    return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  }

  if (mode === "download" && payload.material.status === "deleted") {
    return NextResponse.json({ error: "素材已下架" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", payload.media.mime);
  headers.set(
    "cache-control",
    mode === "thumbnail"
      ? "public, max-age=86400, stale-while-revalidate=604800"
      : "private, max-age=3600",
  );
  if (mode === "download") {
    const fileName = `${payload.material.name || id}.${payload.media.mime.split("/")[1] ?? "bin"}`;
    headers.set(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
  }

  return new NextResponse(new Uint8Array(payload.media.body), { status: 200, headers });
}

export async function GET(request: Request, context: Ctx) {
  return serveImage(request, context, "thumbnail");
}
