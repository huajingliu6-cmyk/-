import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  assertSafeGenerationId,
  readGenerationRecord,
} from "@/video-generation/generation-store";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import { submitVideoGeneration } from "@/video-generation/service";
import {
  listCapabilitiesForProvider,
  pickCapability,
} from "@/video-generation/model-capabilities";
import { getVideoProviderRuntimeConfig } from "@/video-generation/provider/config";
import { MAX_REFERENCE_SELECTION_IDS_IN_REQUEST } from "@/video-generation/reference-media";

const bodySchema = z.object({
  confirmPaidGeneration: z.boolean().optional().default(false),
  /**
   * 可选客户端快照；权威选择来自最新 WorkflowDocument。
   * 不得用旧任务 requestSnapshot 覆盖。
   */
  selectedReferenceAssetIds: z
    .array(z.string().min(1))
    .max(MAX_REFERENCE_SELECTION_IDS_IN_REQUEST)
    .optional(),
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

    // 始终加载最新 WorkflowDocument；选择以节点数据为准，不复用旧任务快照
    const document = await loadWorkflow(old.projectId);
    const runtime = getVideoProviderRuntimeConfig();
    const capabilities = listCapabilitiesForProvider(runtime.providerId, {
      t2vModelId: runtime.t2vModelId,
      r2vModelId: runtime.r2vModelId,
    });
    const r2vCapability = pickCapability(capabilities, "referenceToVideo");

    const built = buildVideoGenerationInput(document, old.shotNodeId, {
      clientSelectedReferenceAssetIds: parsed.data.selectedReferenceAssetIds,
      capability: r2vCapability,
    });
    if (!built.ok) {
      const code =
        built.structuredErrors[0]?.code ??
        (built.requiresManualSelection
          ? "REFERENCE_SELECTION_REQUIRED"
          : "INPUT_INVALID");
      return NextResponse.json(
        {
          code,
          message: built.errors[0] ?? "生成输入无效",
          errors: built.structuredErrors,
          requiresManualSelection: built.requiresManualSelection,
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
