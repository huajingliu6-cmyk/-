import { NextResponse } from "next/server";
import { AiConfigError } from "@/ai-config/errors";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { PERSONAL_VIDEO_CAPABILITY_ID } from "@/personal/video-generation/generate-personal-video";
import {
  getPublicVideoConfigFromRuntime,
  paidGenerationAllowed,
  resolveVideoProviderRuntimeConfig,
} from "@/video-generation/provider/config";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET() {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  try {
    const runtime = await resolveVideoProviderRuntimeConfig(undefined, {
      capabilityId: PERSONAL_VIDEO_CAPABILITY_ID,
      preferAdminConfig: true,
    });
    const publicConfig = getPublicVideoConfigFromRuntime(runtime);
    const paidGate = paidGenerationAllowed(runtime, true);
    return NextResponse.json({
      ready: true,
      capabilityId: PERSONAL_VIDEO_CAPABILITY_ID,
      config: publicConfig,
      paidGate,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message =
      error instanceof Error
        ? error.message
        : "该 AI 功能尚未由系统管理员完成配置，请联系管理员。";
    const code =
      error instanceof AiConfigError ? error.code : "AI_CAPABILITY_NOT_CONFIGURED";
    return NextResponse.json(
      {
        ready: false,
        capabilityId: PERSONAL_VIDEO_CAPABILITY_ID,
        error: message,
        code,
      },
      { status: 503 },
    );
  }
}
