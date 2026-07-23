import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { resolveAssetPath } from "@/workflow/lib/asset-storage";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

/**
 * 读取本地开发素材。生产环境应改为云存储签名 URL。
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { assetId } = await context.params;
    const resolved = await resolveAssetPath(assetId);
    if (!resolved) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }

    const data = await fs.readFile(resolved.filePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": resolved.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("GET /api/assets/[assetId] failed:", error);
    return NextResponse.json({ error: "读取素材失败" }, { status: 500 });
  }
}
