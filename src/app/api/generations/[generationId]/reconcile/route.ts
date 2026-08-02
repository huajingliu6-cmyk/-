import { NextResponse } from "next/server";
import { requireVideoCanvasAccessForGeneration } from "@/auth/require-access";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import { reconcileByGenerationId } from "@/video-generation/idempotency";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import { IdempotencyError } from "@/video-generation/idempotency";

type RouteContext = { params: Promise<{ generationId: string }> };

/**
 * 管理员恢复入口：对账幂等记录与 GenerationRecord。
 * 不调用 Provider，不创建新付费任务。
 */
export async function POST(
  _request: Request,
  context: RouteContext,
) {
  try {
    const { generationId: rawId } = await context.params;
    const gated = await requireVideoCanvasAccessForGeneration(rawId);
    if (!gated.ok) return gated.response;
    const generationId = assertSafeGenerationId(rawId);
    const result = await reconcileByGenerationId(generationId);
    if (!result) {
      return NextResponse.json(
        {
          code: "NOT_FOUND",
          message: "未找到可对账的幂等记录",
          adminHint:
            "确认 generation 是否带 idempotencyKey；未知结果勿自动重放同一键。",
        },
        { status: 404 },
      );
    }
    return NextResponse.json({
      record: result.record,
      generation: result.generation
        ? sanitizeGenerationForClient(result.generation)
        : null,
      mutated: result.mutated,
      note: result.note,
      adminHint:
        "未知结果须人工核对 Provider 控制台；禁止自动用同一幂等键再次付费提交。",
    });
  } catch (error) {
    if (error instanceof IdempotencyError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        code: "RECONCILE_FAILED",
        message: error instanceof Error ? error.message : "对账失败",
      },
      { status: 400 },
    );
  }
}
