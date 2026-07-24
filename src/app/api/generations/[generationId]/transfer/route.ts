import { NextRequest, NextResponse } from "next/server";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import { retryTransferGeneration } from "@/video-generation/service";

type RouteContext = { params: Promise<{ generationId: string }> };

/** 转存失败后重试下载临时 URL（已有结果时幂等返回） */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { generationId: rawId } = await context.params;
    const generationId = assertSafeGenerationId(rawId);
    const result = await retryTransferGeneration(generationId, {
      title: "镜头",
    });

    return NextResponse.json({
      generation: result.generation,
      asset: result.asset,
      idempotent: result.idempotent,
    });
  } catch (error) {
    const err = error as Error & { code?: string };
    const code = err.code ?? "RESULT_TRANSFER_FAILED";
    const status = code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json(
      {
        code,
        message: err.message || "转存失败",
      },
      { status },
    );
  }
}
