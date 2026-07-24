import { NextRequest, NextResponse } from "next/server";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import { cancelVideoGeneration } from "@/video-generation/service";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";

type RouteContext = { params: Promise<{ generationId: string }> };

export async function POST(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { generationId: rawId } = await context.params;
    const generationId = assertSafeGenerationId(rawId);
    const generation = await cancelVideoGeneration(generationId);
    return NextResponse.json({
      generation: sanitizeGenerationForClient(generation),
    });
  } catch (error) {
    const err = error as Error & { code?: string };
    return NextResponse.json(
      {
        code: err.code ?? "CANCEL_FAILED",
        message: err.message || "取消失败",
      },
      { status: 400 },
    );
  }
}
