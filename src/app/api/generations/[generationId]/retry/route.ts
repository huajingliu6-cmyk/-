import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertSafeGenerationId,
  readGenerationRecord,
} from "@/video-generation/generation-store";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import { submitVideoGeneration } from "@/video-generation/service";

const bodySchema = z.object({
  confirmPaidGeneration: z.boolean().optional().default(false),
  selectedReferenceAssetIds: z.array(z.string()).max(5).optional(),
  title: z.string().optional(),
});

type RouteContext = { params: Promise<{ generationId: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { generationId: rawId } = await context.params;
    const oldId = assertSafeGenerationId(rawId);
    const old = await readGenerationRecord(oldId);
    if (!old) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "原任务不存在" },
        { status: 404 },
      );
    }

    const json = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "INVALID_BODY", message: "参数无效" },
        { status: 400 },
      );
    }

    // 始终加载最新 WorkflowDocument；新任务不复用旧 providerTaskId
    const document = await loadWorkflow(old.projectId);

    const built = buildVideoGenerationInput(document, old.shotNodeId, {
      selectedReferenceAssetIds: parsed.data.selectedReferenceAssetIds,
    });
    if (!built.ok) {
      return NextResponse.json(
        {
          code: "INPUT_INVALID",
          message: built.errors[0] ?? "生成输入无效",
          errors: built.errors,
        },
        { status: 400 },
      );
    }

    const generation = await submitVideoGeneration({
      input: built.input,
      unsupportedAudioLabels: built.unsupportedAudioLabels,
      confirmPaidGeneration: parsed.data.confirmPaidGeneration,
      title: parsed.data.title,
    });

    return NextResponse.json({
      generation,
      previousGenerationId: oldId,
    });
  } catch (error) {
    const err = error as Error & { code?: string };
    return NextResponse.json(
      {
        code: err.code ?? "RETRY_FAILED",
        message: err.message || "重试失败",
      },
      { status: 400 },
    );
  }
}
