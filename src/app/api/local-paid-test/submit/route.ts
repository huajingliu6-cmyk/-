import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/auth/require-user";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { buildVideoGenerationInput } from "@/workflow/lib/build-video-generation-input";
import {
  listCapabilitiesForProvider,
  pickCapability,
} from "@/video-generation/model-capabilities";
import { getVideoProviderRuntimeConfig } from "@/video-generation/provider/config";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import { IdempotencyError } from "@/video-generation/idempotency";
import {
  FileWanLocalPaidTestGuardStore,
  LocalPaidTestError,
  LOCAL_PAID_TEST_SUBMIT_WARNING,
  readLocalPaidTestOriginHeaders,
  submitWan27LocalOneShotPaidTest,
  validateLocalPaidTestRequestOrigin,
} from "@/video-generation/local-paid-test";

/**
 * 客户端只允许这些字段。禁止 Provider / Endpoint / 模型 / remoteVideoUrl / providerTaskId。
 */
const bodySchema = z
  .object({
    projectId: z.string().min(1),
    shotNodeId: z.string().min(1),
    confirmPaidGeneration: z.literal(true),
    token: z.string().min(1).max(512),
    confirmationPhrase: z.string().min(1).max(200),
    armNonce: z.string().min(1).max(256),
    idempotencyKey: z.string().min(1).max(120),
  })
  .strict();

const FORBIDDEN_CLIENT_KEYS = [
  "providerId",
  "provider",
  "endpoint",
  "modelId",
  "providerModelId",
  "remoteVideoUrl",
  "providerTaskId",
  "dashscopeApiKey",
  "apiKey",
] as const;

function statusForLocalPaidCode(code: string): number {
  if (
    code === "LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION" ||
    code === "LOCAL_PAID_TEST_LOOPBACK_REQUIRED" ||
    code === "LOCAL_PAID_TEST_ORIGIN_INVALID" ||
    code === "LOCAL_PAID_TEST_CSRF_REJECTED" ||
    code === "LOCAL_PAID_TEST_PROXY_NOT_ALLOWED" ||
    code === "PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE"
  ) {
    return 403;
  }
  if (
    code === "LOCAL_PAID_TEST_TOKEN_INVALID" ||
    code === "LOCAL_PAID_TEST_CONFIRMATION_INVALID"
  ) {
    return 401;
  }
  if (
    code === "LOCAL_PAID_TEST_ALREADY_IN_PROGRESS" ||
    code === "LOCAL_PAID_TEST_NONCE_REUSED" ||
    code === "LOCAL_PAID_TEST_REQUEST_MISMATCH" ||
    code === "LOCAL_PAID_TEST_UNKNOWN_OUTCOME" ||
    code === "LOCAL_PAID_TEST_ALREADY_CONSUMED" ||
    code === "IDEMPOTENCY_IN_PROGRESS" ||
    code === "ACTIVE_GENERATION_ALREADY_EXISTS" ||
    code === "GENERATION_SUBMISSION_UNKNOWN" ||
    code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
  ) {
    return 409;
  }
  return 400;
}

export async function GET() {
  return NextResponse.json(
    {
      code: "METHOD_NOT_ALLOWED",
      message: "一次性真实提交仅允许 POST，且不能通过页面加载触发。",
    },
    { status: 405 },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  try {
    validateLocalPaidTestRequestOrigin(
      readLocalPaidTestOriginHeaders(request.headers),
    );

    // 拒绝 query 触发
    if (request.nextUrl.searchParams.size > 0) {
      return NextResponse.json(
        {
          code: "LOCAL_PAID_TEST_DISABLED",
          message: "禁止通过 query 参数触发付费提交。",
        },
        { status: 400 },
      );
    }

    const json: unknown = await request.json();
    if (!json || typeof json !== "object") {
      return NextResponse.json(
        { code: "INVALID_BODY", message: "请求体无效。" },
        { status: 400 },
      );
    }

    const raw = json as Record<string, unknown>;
    const rejectedClientFields = FORBIDDEN_CLIENT_KEYS.filter((k) => k in raw);

    const parsed = bodySchema.safeParse(json);
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
    const t2vCapability = pickCapability(capabilities, "textToVideo");

    const built = buildVideoGenerationInput(document, body.shotNodeId, {
      capability: t2vCapability,
    });
    if (!built.ok) {
      return NextResponse.json(
        {
          code:
            built.structuredErrors[0]?.code ??
            "LOCAL_PAID_TEST_SPEC_NOT_ALLOWED",
          message: built.errors[0] ?? "工作流不满足一次性测试最低规格",
        },
        { status: 400 },
      );
    }

    const guardStore = new FileWanLocalPaidTestGuardStore({
      namespace: "live",
    });

    const record = await submitWan27LocalOneShotPaidTest({
      guardStore,
      generationInput: built.input,
      unsupportedAudioLabels: built.unsupportedAudioLabels,
      rejectedClientFields: [...rejectedClientFields],
      client: {
        projectId: body.projectId,
        shotNodeId: body.shotNodeId,
        confirmPaidGeneration: true,
        token: body.token,
        confirmationPhrase: body.confirmationPhrase,
        armNonce: body.armNonce,
        idempotencyKey: body.idempotencyKey,
      },
    });

    return NextResponse.json({
      generation: sanitizeGenerationForClient(record),
      warning: LOCAL_PAID_TEST_SUBMIT_WARNING,
      notice: "已提交一次性测试任务（若为真实 Provider 可能产生费用）。",
    });
  } catch (error) {
    if (error instanceof LocalPaidTestError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: statusForLocalPaidCode(error.code) },
      );
    }
    if (error instanceof IdempotencyError) {
      return NextResponse.json(
        {
          code: error.code,
          message: error.message,
          generationId: error.generationId,
        },
        { status: statusForLocalPaidCode(error.code) },
      );
    }
    const err = error as Error & {
      code?: string;
      generation?: unknown;
    };
    return NextResponse.json(
      {
        code: err.code ?? "SUBMIT_FAILED",
        message: err.message || "一次性提交失败",
      },
      { status: statusForLocalPaidCode(err.code ?? "SUBMIT_FAILED") },
    );
  }
}
