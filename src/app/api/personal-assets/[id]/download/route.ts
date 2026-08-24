import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { readPersonalAssetMedia } from "@/personal-assets/media";
import { getPersonalAssetForUser } from "@/personal-assets/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少素材 ID" }, { status: 400 });
  }

  try {
    const asset = await getPersonalAssetForUser({
      userId: gated.user.id,
      assetId: id,
    });
    if (!asset) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }

    const media = await readPersonalAssetMedia(asset.storageKey);
    if (!media) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const safeName = asset.name.replace(/[\\/:*?"<>|]/g, "_");
    const extension =
      asset.mimeType === "image/png"
        ? "png"
        : asset.mimeType === "image/webp"
          ? "webp"
          : "jpg";

    return new NextResponse(new Uint8Array(media.body), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(media.body.length),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(`${safeName}.${extension}`)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
