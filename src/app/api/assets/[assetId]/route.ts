import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteAssetFile,
  resolveAssetPath,
} from "@/workflow/lib/asset-storage";
import { collectReferencedAssetIds } from "@/workflow/lib/asset-refs";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";
import {
  buildVideoContentHeaders,
  planAssetContentResponse,
  resolveGeneratedVideoForServe,
} from "@/video-generation/serve-generated-video";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

/**
 * 读取本地开发素材。
 * - 图片/音频：按 assetId 安全读盘（兼容现有缩略图）
 * - generatedVideo：必须带 generationId 或 projectId，支持 Range / 流式
 * 生产环境应改为云存储签名 URL。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { assetId } = await context.params;
    const download =
      request.nextUrl.searchParams.get("download") === "1" ||
      request.nextUrl.searchParams.get("download") === "true";
    const generationId = request.nextUrl.searchParams.get("generationId");
    const projectId = request.nextUrl.searchParams.get("projectId");
    const shotNumberRaw = request.nextUrl.searchParams.get("shotNumber");
    const clientStoragePath = request.nextUrl.searchParams.get("storagePath");
    const shotNumber = shotNumberRaw ? Number(shotNumberRaw) : null;

    // 最终视频：走 assetId + 上下文校验（禁止 fileName / storagePath）
    if (generationId || projectId || download || clientStoragePath) {
      const resolved = await resolveGeneratedVideoForServe({
        assetId,
        generationId,
        projectId,
        clientStoragePath,
        shotNumber:
          shotNumber != null && Number.isFinite(shotNumber) ? shotNumber : null,
      });
      if (!resolved.ok) {
        return NextResponse.json(
          { code: resolved.code, message: resolved.message },
          { status: resolved.status },
        );
      }

      const file = resolved.value;
      const plan = planAssetContentResponse({
        rangeHeader: request.headers.get("range"),
        fileSize: file.sizeBytes,
      });
      if (!plan.ok) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": plan.contentRange,
            "Accept-Ranges": "bytes",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      const headers = buildVideoContentHeaders({
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        download,
        downloadFileName: file.downloadFileName,
        contentRange: plan.contentRange,
        contentLength: plan.contentLength,
      });

      // 浏览器 <video> 几乎总会带 Range；Node→Web Stream 在本环境会挂起，
      // 开发态视频文件通常不大，统一读入 Buffer 再返回。
      if (plan.status === 200 || plan.start == null || plan.end == null) {
        const data = await fs.readFile(file.filePath);
        return new NextResponse(data, {
          status: 200,
          headers: buildVideoContentHeaders({
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            download,
            downloadFileName: file.downloadFileName,
            contentLength: file.sizeBytes,
          }),
        });
      }

      const length = plan.end - plan.start + 1;
      const handle = await fs.open(file.filePath, "r");
      try {
        const data = Buffer.alloc(length);
        const { bytesRead } = await handle.read(
          data,
          0,
          length,
          plan.start,
        );
        const body =
          bytesRead === length ? data : data.subarray(0, bytesRead);
        return new NextResponse(body, {
          status: 206,
          headers,
        });
      } finally {
        await handle.close();
      }
    }

    // 非视频上下文：保持原有图片/音频读取（整文件；小素材）
    const resolved = await resolveAssetPath(assetId);
    if (!resolved) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "素材不存在" },
        { status: 404 },
      );
    }

    if (resolved.mimeType.startsWith("video/")) {
      return NextResponse.json(
        {
          code: "CONTEXT_REQUIRED",
          message: "播放生成视频需要 generationId 或 projectId",
        },
        { status: 400 },
      );
    }

    const data = await fs.readFile(resolved.filePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": resolved.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET /api/assets/[assetId] failed:", error);
    return NextResponse.json(
      { code: "READ_FAILED", message: "读取素材失败" },
      { status: 500 },
    );
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
