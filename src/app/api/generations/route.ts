import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import {
  getVideoGenerationPublicConfig,
  submitVideoGeneration,
} from "@/video-generation/service";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import type { GenerationRecord } from "@/video-generation/types";
import {
  listCapabilitiesForProvider,
  pickCapability,
} from "@/video-generation/model-capabilities";
import { getVideoProviderRuntimeConfig } from "@/video-generation/provider/config";
import { selectWanGenerationMode } from "@/video-generation/select-wan-mode";
import { MAX_REFERENCE_SELECTION_IDS_IN_REQUEST } from "@/video-generation/reference-media";

const postSchema = z.object({
  projectId: z.string().min(1),
  videoShotNodeId: z.string().min(1),
  confirmPaidGeneration: z.boolean().optional().default(false),
  idempotencyKey: z.string().max(120).optional(),
  /**
   * 可选客户端快照：必须与 WorkflowDocument 节点上的选择完全一致（含顺序）。
   * 权威来源始终是服务端加载的最新工作流。
   * 长度上限仅为 HTTP Payload 安全限制，不是模型能力上限。
   */
  selectedReferenceAssetIds: z
    .array(z.string().min(1))
    .max(MAX_REFERENCE_SELECTION_IDS_IN_REQUEST)
    .optional(),
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
    const runtime = getVideoProviderRuntimeConfig();
    const capabilities = listCapabilitiesForProvider(runtime.providerId, {
      t2vModelId: runtime.t2vModelId,
      r2vModelId: runtime.r2vModelId,
    });

    // 先用 R2V 能力收集/解析（支持参考素材）；最终 mode 仍由最终 input 决定
    const r2vCapability = pickCapability(capabilities, "referenceToVideo");

    const built = buildVideoGenerationInput(document, body.videoShotNodeId, {
      clientSelectedReferenceAssetIds: body.selectedReferenceAssetIds,
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
          candidates: built.candidates,
        },
        { status: 400 },
      );
    }

    // 若最终为 T2V，用 T2V 能力再校验是否误带参考（由 select + validate 处理）
    const mode = selectWanGenerationMode(built.input);
    const capability = pickCapability(capabilities, mode);
    if (capability.mode !== r2vCapability.mode) {
      // 无参考素材时走 T2V；重新构建不是必须，validate 会按 T2V 规则检查
    }

    const record = await submitVideoGeneration({
      input: built.input,
      unsupportedAudioLabels: built.unsupportedAudioLabels,
      confirmPaidGeneration: body.confirmPaidGeneration,
      idempotencyKey: body.idempotencyKey,
      title: body.title,
    });

    return NextResponse.json({
      generation: sanitizeGenerationForClient(record),
    });
  } catch (error) {
    const err = error as Error & {
      code?: string;
      errors?: unknown;
      generation?: GenerationRecord;
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
        generation: err.generation
          ? sanitizeGenerationForClient(err.generation)
          : undefined,
      },
      { status },
    );
  }
}
