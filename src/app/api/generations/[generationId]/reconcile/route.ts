import { NextResponse } from "next/server";
import { requireVideoCanvasAccessForGeneration } from "@/auth/require-access";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import { reconcileGenerationInGo } from "@/video-generation/remote-reconcile";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";

type RouteContext = { params: Promise<{ generationId: string }> };

type ReconcilePayload = {
  record?: unknown;
  generation?: Record<string, unknown> | null;
  mutated?: unknown;
  note?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
  adminHint?: unknown;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { generationId: rawId } = await context.params;
    const gated = await requireVideoCanvasAccessForGeneration(rawId);
    if (!gated.ok) return gated.response;
    const generationId = assertSafeGenerationId(rawId);
    const response = await reconcileGenerationInGo(generationId, gated.user.id);
    const payload = (await response.json().catch(() => ({}))) as ReconcilePayload;
    if (!response.ok) {
      return NextResponse.json(
        {
          code:
            typeof payload.code === "string"
              ? payload.code
              : typeof payload.error === "string"
                ? payload.error
                : "RECONCILE_FAILED",
          message:
            typeof payload.message === "string"
              ? payload.message
              : "\u5bf9\u8d26\u5931\u8d25",
          ...(typeof payload.adminHint === "string"
            ? { adminHint: payload.adminHint }
            : {}),
        },
        { status: response.status },
      );
    }
    return NextResponse.json({
      record: payload.record,
      generation:
        payload.generation && typeof payload.generation === "object"
          ? sanitizeGenerationForClient(payload.generation as never)
          : null,
      mutated: payload.mutated === true,
      note: typeof payload.note === "string" ? payload.note : "\u65e0\u53d8\u66f4",
      adminHint:
        "\u672a\u77e5\u7ed3\u679c\u5fc5\u987b\u4eba\u5de5\u6838\u5bf9 Provider \u63a7\u5236\u53f0\uff1b\u7981\u6b62\u81ea\u52a8\u91cd\u653e\u540c\u4e00\u5e42\u7b49\u952e\u3002",
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json(
        { code: "REMOTE_DATA_UNAVAILABLE", message: "\u5185\u7f51\u4e1a\u52a1\u670d\u52a1\u4e0d\u53ef\u7528" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        code: "RECONCILE_FAILED",
        message: error instanceof Error ? error.message : "????",
      },
      { status: 400 },
    );
  }
}
