import { NextResponse } from "next/server";
import { requireAdminUser } from "@/auth/require-user";
import { buildWan27DryRunPreview } from "@/video-generation/provider/wan27-dry-run";
import {
  LOCAL_PAID_TEST_SPEC,
  isDevelopmentNodeEnv,
} from "@/video-generation/local-paid-test";
import type { VideoGenerationInput } from "@/video-generation/types";

function fixedSpecInput(): VideoGenerationInput {
  return {
    shotId: "local-paid-test-preview",
    projectId: "local-paid-test",
    prompt: "dry-run-preview-only",
    resolution: LOCAL_PAID_TEST_SPEC.resolution,
    aspectRatio: LOCAL_PAID_TEST_SPEC.aspectRatio,
    durationSeconds: LOCAL_PAID_TEST_SPEC.durationSeconds,
    watermark: false,
    promptExtend: false,
    characterReferences: [],
    sceneReferences: [],
    imageReferences: [],
    referenceVideos: [],
    orderedReferenceMedia: [],
    textInputs: [],
    referenceSelectionMode: "auto",
    selectedReferenceAssetIds: [],
  };
}

export async function POST() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;
  if (!isDevelopmentNodeEnv()) {
    return NextResponse.json(
      {
        code: "LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION",
        message: "一次性付费测试仅允许在本机开发环境中执行。",
      },
      { status: 403 },
    );
  }

  const preview = buildWan27DryRunPreview({
    input: fixedSpecInput(),
    resolvedMedia: [],
    env: process.env,
  });

  return NextResponse.json({
    ok: true,
    preview,
    notice: "当前不会发送真实请求，也不会产生费用。",
  });
}
