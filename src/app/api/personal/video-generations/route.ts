import { NextResponse } from "next/server";
import { AiConfigError } from "@/ai-config/errors";
import { requireAuthenticatedUser } from "@/auth/require-access";
import {
  generatePersonalVideo,
  PERSONAL_VIDEO_CAPABILITY_ID,
} from "@/personal/video-generation/generate-personal-video";
import { listPersonalVideoHistory } from "@/personal/video-generation/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import {
  paidGenerationAllowed,
  resolveVideoProviderRuntimeConfig,
} from "@/video-generation/provider/config";

export async function GET() {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  try {
    const videos = await listPersonalVideoHistory(gated.user.id);
    return NextResponse.json({ videos });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  try {
    const runtime = await resolveVideoProviderRuntimeConfig(undefined, {
      capabilityId: PERSONAL_VIDEO_CAPABILITY_ID,
      preferAdminConfig: true,
    });
    const paidGate = paidGenerationAllowed(runtime, true);
    if (!paidGate.ok) {
      return NextResponse.json(
        { error: paidGate.message, code: paidGate.code },
        { status: paidGate.code === "PAID_GENERATION_DISABLED" ? 403 : 503 },
      );
    }

    const payload = await generatePersonalVideo({
      userId: gated.user.id,
      form,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message =
      error instanceof Error ? error.message : "视频生成失败";
    const code =
      error instanceof AiConfigError
        ? error.code
        : error &&
            typeof error === "object" &&
            "code" in error &&
            typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : undefined;
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : code === "AI_CAPABILITY_NOT_CONFIGURED"
          ? 503
          : 500;
    return NextResponse.json({ error: message, code }, { status });
  }
}
