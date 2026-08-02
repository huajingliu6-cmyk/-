import { NextRequest, NextResponse } from "next/server";
import { requireVideoCanvasAccessForGeneration } from "@/auth/require-access";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import { refreshGenerationStatus } from "@/video-generation/service";
import { compareRequestedAndActualGeneration } from "@/video-generation/compare-params";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import type { AssetRecord } from "@/workflow/types";

type RouteContext = { params: Promise<{ generationId: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { generationId: rawId } = await context.params;
    const gated = await requireVideoCanvasAccessForGeneration(rawId);
    if (!gated.ok) return gated.response;

    const generationId = assertSafeGenerationId(rawId);
    const record = await refreshGenerationStatus(generationId);
    const comparison = compareRequestedAndActualGeneration(record);
    const transferred = (
      record as { _transferredAsset?: AssetRecord }
    )._transferredAsset;

    return NextResponse.json({
      generation: sanitizeGenerationForClient(record),
      comparison,
      asset: transferred ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: "GENERATION_LOOKUP_FAILED",
        message: error instanceof Error ? error.message : "查询失败",
      },
      { status: 400 },
    );
  }
}
