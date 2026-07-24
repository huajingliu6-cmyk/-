import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import {
  getVideoGenerationPublicConfig,
  submitVideoGeneration,
} from "@/video-generation/service";
import { listCapabilitiesForProvider } from "@/video-generation/model-capabilities";
import { getVideoProviderRuntimeConfig } from "@/video-generation/provider/config";

const postSchema = z.object({
  projectId: z.string().min(1),
  videoShotNodeId: z.string().min(1),
  confirmPaidGeneration: z.boolean().optional().default(false),
  idempotencyKey: z.string().max(120).optional(),
  selectedReferenceAssetIds: z.array(z.string()).max(5).optional(),
  title: z.string().optional(),
});

export async function GET() {
  const runtime = getVideoProviderRuntimeConfig();
  const publicConfig = getVideoGenerationPublicConfig();
  const capabilities = listCapabilitiesForProvider(runtime.providerId, {
    t2vModelId: runtime.t2vModelId,
    r2vModelId: runtime.r2vModelId,
  });
  return NextResponse.json({
    config: publicConfig,
    capabilities,
  });
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "INVALID_BODY",
          message: parsed.error.issues[0]?.message ?? "参数无效",
        },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const document = await loadWorkflow(body.projectId);

    const built = buildVideoGenerationInput(document, body.videoShotNodeId, {
      selectedReferenceAssetIds: body.selectedReferenceAssetIds,
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

    const record = await submitVideoGeneration({
      input: built.input,
      unsupportedAudioLabels: built.unsupportedAudioLabels,
      confirmPaidGeneration: body.confirmPaidGeneration,
      idempotencyKey: body.idempotencyKey,
      title: body.title,
    });

    return NextResponse.json({ generation: record });
  } catch (error) {
    const err = error as Error & {
      code?: string;
      errors?: unknown;
      generation?: unknown;
    };
    const code = err.code ?? "SUBMIT_FAILED";
    const status =
      code === "PAID_GENERATION_DISABLED"
        ? 403
        : code === "MISSING_DASHSCOPE_API_KEY" ||
            code === "MISSING_DASHSCOPE_WORKSPACE_ID"
          ? 503
          : 400;
    return NextResponse.json(
      {
        code,
        message: err.message || "提交生成失败",
        errors: err.errors,
        generation: err.generation ?? undefined,
      },
      { status },
    );
  }
}
