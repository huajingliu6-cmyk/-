import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import { updateGenerationBrowserMetadata } from "@/video-generation/update-browser-metadata";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";

type RouteContext = { params: Promise<{ generationId: string }> };

const bodySchema = z.object({
  videoAssetId: z.string().uuid(),
  actualWidth: z.number().int().positive(),
  actualHeight: z.number().int().positive(),
  actualDurationSeconds: z.number().positive().finite(),
  metadataSource: z.literal("browser"),
});

/**
 * 浏览器 loadedmetadata 写回 actual*；不允许伪装 server/provider。
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { generationId: rawId } = await context.params;
    const generationId = assertSafeGenerationId(rawId);
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "INVALID_BODY",
          message: parsed.error.issues[0]?.message ?? "参数无效",
        },
        { status: 400 },
      );
    }

    const result = await updateGenerationBrowserMetadata({
      generationId,
      videoAssetId: parsed.data.videoAssetId,
      actualWidth: parsed.data.actualWidth,
      actualHeight: parsed.data.actualHeight,
      actualDurationSeconds: parsed.data.actualDurationSeconds,
    });

    if (!result.ok) {
      return NextResponse.json(
        { code: result.code, message: result.message },
        { status: result.status },
      );
    }

    return NextResponse.json({
      generation: sanitizeGenerationForClient(result.generation),
      idempotent: result.idempotent,
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: "METADATA_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "元数据写回失败",
      },
      { status: 400 },
    );
  }
}
