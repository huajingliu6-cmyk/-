import { NextRequest, NextResponse } from "next/server";
import {
  classifyAsset,
  saveAssetFile,
} from "@/workflow/lib/asset-storage";

const IMAGE_MAX = 10 * 1024 * 1024;
const AUDIO_MAX = 50 * 1024 * 1024;

/**
 * 本地开发素材上传。
 * 文件写入 data/assets/，不适合 Vercel 生产环境；生产应替换为 Supabase Storage。
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "请使用 multipart/form-data 上传 file 字段" },
        { status: 400 },
      );
    }

    const mimeType = file.type || "";
    const classified = classifyAsset(mimeType, file.name);
    if ("error" in classified) {
      return NextResponse.json({ error: classified.error }, { status: 400 });
    }

    const max = classified.kind === "image" ? IMAGE_MAX : AUDIO_MAX;
    if (file.size > max) {
      return NextResponse.json(
        {
          error:
            classified.kind === "image"
              ? "图片不能超过 10MB"
              : "音频不能超过 50MB",
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await saveAssetFile({
      buffer,
      mimeType,
      fileName: file.name,
      kind: classified.kind,
      ext: classified.ext,
    });

    return NextResponse.json({
      assetId: stored.assetId,
      assetUrl: stored.assetUrl,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      kind: stored.kind,
    });
  } catch (error) {
    console.error("POST /api/assets failed:", error);
    return NextResponse.json({ error: "上传素材失败" }, { status: 500 });
  }
}
