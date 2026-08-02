import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVideoCanvasAccessForGeneration } from "@/auth/require-access";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import { assertSafeGenerationId } from "@/video-generation/generation-store";
import {
  type BrowserMetadataCommandResult,
  updateBrowserMetadataInGo,
} from "@/video-generation/remote-browser-metadata";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";

type RouteContext = { params: Promise<{ generationId: string }> };

const bodySchema = z.object({
  videoAssetId: z.string().uuid(),
  actualWidth: z.number().int().positive(),
  actualHeight: z.number().int().positive(),
  actualDurationSeconds: z.number().positive().finite(),
  metadataSource: z.literal("browser"),
});

type ErrorPayload = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { generationId: rawId } = await context.params;
    const gated = await requireVideoCanvasAccessForGeneration(rawId);
    if (!gated.ok) return gated.response;
    const generationId = assertSafeGenerationId(rawId);

    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "INVALID_BODY",
          message: parsed.error.issues[0]?.message ?? "\u53c2\u6570\u65e0\u6548",
        },
        { status: 400 },
      );
    }

    const response = await updateBrowserMetadataInGo(
      {
        generationId,
        videoAssetId: parsed.data.videoAssetId,
        actualWidth: parsed.data.actualWidth,
        actualHeight: parsed.data.actualHeight,
        actualDurationSeconds: parsed.data.actualDurationSeconds,
      },
      gated.user.id,
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
      return NextResponse.json(
        {
          code: typeof payload.code === "string" ? payload.code : "METADATA_UPDATE_FAILED",
          message:
            typeof payload.message === "string"
              ? payload.message
              : typeof payload.error === "string"
                ? payload.error
                : "\u5143\u6570\u636e\u5199\u56de\u5931\u8d25",
        },
        { status: response.status },
      );
    }

    const result = (await response.json()) as BrowserMetadataCommandResult;
    return NextResponse.json({
      generation: sanitizeGenerationForClient(result.record),
      idempotent: result.idempotent,
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
        code: "METADATA_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "\u5143\u6570\u636e\u5199\u56de\u5931\u8d25",
      },
      { status: 400 },
    );
  }
}
