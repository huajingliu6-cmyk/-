import { NextResponse } from "next/server";
import { AiConfigError } from "@/ai-config/errors";
import { requireActualProjectOwner } from "@/auth/require-access";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import {
  computeShotVideoContentHash,
  getShotVideoPrompt,
} from "@/projects/storyboard/shot-completeness";
import { getShotVideoBlocker } from "@/projects/storyboard/shot-video-precheck";
import { submitStoryboardShotVideo } from "@/projects/storyboard/services/storyboard-video-generate";
import {
  appendShotVideoHistory,
  appendStoryboardVideoHistory,
} from "@/projects/storyboard/video-history-ids";
import { resolveStoryboardVideoOutputParams } from "@/projects/storyboard/storyboard-video-params";
import { providerModelIdForStoryboardVideoModelChoice } from "@/projects/storyboard/storyboard-video-model-choices";
import {
  paidGenerationAllowed,
  resolveVideoProviderRuntimeConfig,
} from "@/video-generation/provider/config";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import {
  releaseGenerationCredits,
  reserveVideoGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; shotId: string }>;
};

/**
 * POST 生成本镜头视频
 * Body: { storyboardRevision, shotRevision, idempotencyKey, confirmPaidGeneration? }
 */
export async function POST(request: Request, context: RouteContext) {
  const { projectId, episodeId, shotId } = await context.params;

  const videoGate = await requireActualProjectOwner(projectId);
  if (!videoGate.ok) return videoGate.response;

  const loaded = await loadAuthorizedWorkspace(projectId, videoGate.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  if (!production.activeStoryboard) {
    return NextResponse.json({ error: "分镜尚未生成" }, { status: 400 });
  }

  const storyboard = production.activeStoryboard;

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  if ("providerModelId" in body || "modelId" in body || "providerId" in body) {
    return NextResponse.json(
      { error: "不允许客户端指定 Provider 或模型", code: "CLIENT_MODEL_FORBIDDEN" },
      { status: 400 },
    );
  }

  if (
    typeof body.storyboardRevision !== "number" ||
    body.storyboardRevision !== storyboard.revision
  ) {
    return NextResponse.json(
      {
        error: "分镜版本已变化，请刷新后重试",
        code: "STORYBOARD_REVISION_CONFLICT",
      },
      { status: 409 },
    );
  }

  const shot = storyboard.scenes
    .flatMap((s) => s.shots)
    .find((s) => s.id === shotId);
  if (!shot) {
    return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
  }

  if (
    typeof body.shotRevision === "number" &&
    body.shotRevision !== shot.revision
  ) {
    return NextResponse.json(
      { error: "镜头已被更新，请刷新后重试", code: "REVISION_CONFLICT" },
      { status: 409 },
    );
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : null;
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 idempotencyKey", code: "IDEMPOTENCY_KEY_REQUIRED" },
      { status: 400 },
    );
  }

  const confirmPaidGeneration = body.confirmPaidGeneration === true;
  let runtime;
  try {
    runtime = await resolveVideoProviderRuntimeConfig(undefined, {
      capabilityId: "video.storyboard-shot.generate",
      preferAdminConfig: true,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "该 AI 功能尚未由系统管理员完成配置，请联系管理员。";
    const code =
      err instanceof AiConfigError ? err.code : "AI_CAPABILITY_NOT_CONFIGURED";
    return NextResponse.json({ error: message, code }, { status: 503 });
  }
  const paidGate = paidGenerationAllowed(runtime, confirmPaidGeneration);
  if (!paidGate.ok) {
    return NextResponse.json(
      { error: paidGate.message, code: paidGate.code },
      { status: paidGate.code === "PAID_GENERATION_DISABLED" ? 403 : 503 },
    );
  }

  const assets = await loadAssetBundleDraft(projectId);
  const validSceneIds = new Set((assets?.scenes ?? []).map((s) => s.id));
  const blocker = getShotVideoBlocker(shot, validSceneIds);
  if (blocker) {
    return NextResponse.json(
      {
        error: blocker.message,
        code: blocker.code,
        shotId: blocker.shotId,
      },
      { status: 400 },
    );
  }

  if (!getShotVideoPrompt(shot)) {
    return NextResponse.json(
      { error: "镜头缺少视频提示词", code: "MISSING_PROMPT" },
      { status: 400 },
    );
  }

  const outputParams = resolveStoryboardVideoOutputParams(
    body,
    shot.durationSeconds,
    loaded.context.workspace.videoDefaults,
  );

  const shotIdempotencyKey = `${idempotencyKey}:${shotId}`;
  const reserved = await reserveVideoGenerationCredits({
    projectId,
    actorUserId: videoGate.user.id,
    shotId,
    idempotencyKey: shotIdempotencyKey,
    resolution: outputParams.resolution,
    durationSeconds: outputParams.durationSeconds,
  });
  if (!reserved.ok) return reserved.response;

  const submitted = await submitStoryboardShotVideo({
    projectId,
    shot,
    assets,
    idempotencyKey: shotIdempotencyKey,
    confirmPaidGeneration,
    resolution: outputParams.resolution,
    aspectRatio: outputParams.aspectRatio,
    durationSeconds: outputParams.durationSeconds,
    stylePreset: outputParams.stylePreset || undefined,
    modelIdOverride: providerModelIdForStoryboardVideoModelChoice(
      outputParams.modelChoice,
    ),
  });

  if (!submitted.ok) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId,
      reason: "storyboard-video-provider-failed",
    });
    return NextResponse.json(
      { error: submitted.message, code: submitted.code },
      { status: submitted.status ?? 400 },
    );
  }

  // Provider accepted: charge now. Local persist failures must not refund.
  const credit = await settleGenerationCredits({
    reservationId: reserved.reservationId,
    projectId,
    actualPoints: reserved.quote.points,
    reason: "storyboard-video-generation-settle",
    knownBalance: reserved.balance,
  });

  const now = new Date().toISOString();
  const nextScenes = storyboard.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((s) => {
      if (s.id !== shotId) return s;
      const withHistory = appendShotVideoHistory(s, submitted.generation.id);
      return {
        ...withHistory,
        videoContentStale: false,
        lastVideoContentHash: computeShotVideoContentHash(s),
      };
    }),
  }));

  const nextStoryboard = appendStoryboardVideoHistory(
    {
      ...storyboard,
      scenes: nextScenes,
      revision: storyboard.revision + 1,
      updatedAt: now,
    },
    [submitted.generation.id],
  );

  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextStoryboard,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    generation: sanitizeGenerationForClient(submitted.generation),
    production: updated,
    credit: {
      ...credit,
      resolution: reserved.quote.resolution,
      durationSeconds: reserved.quote.durationSeconds,
    },
    ...(submitted.notice ? { notice: submitted.notice } : {}),
  });
}
