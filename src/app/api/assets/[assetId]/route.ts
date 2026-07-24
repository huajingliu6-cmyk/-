import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteAssetFile,
  resolveAssetPath,
} from "@/workflow/lib/asset-storage";
import { collectReferencedAssetIds } from "@/workflow/lib/asset-refs";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";

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

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { assetId } = await context.params;
    const projectId =
      request.nextUrl.searchParams.get("projectId") ?? DEMO_PROJECT_ID;

    const document = await loadWorkflow(projectId);
    const referenced = collectReferencedAssetIds(document);
    if (referenced.has(assetId)) {
      return NextResponse.json(
        { error: "该素材仍被节点引用，无法删除" },
        { status: 409 },
      );
    }

    const deleted = await deleteAssetFile(assetId);
    if (!deleted) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, assetId, projectId });
  } catch (error) {
    console.error("DELETE /api/assets/[assetId] failed:", error);
    return NextResponse.json({ error: "删除素材失败" }, { status: 500 });
  }
}
