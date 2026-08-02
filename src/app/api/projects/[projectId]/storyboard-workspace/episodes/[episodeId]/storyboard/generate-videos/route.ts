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
  listFlatShots,
} from "@/projects/storyboard/shot-completeness";
import { listShotVideoBlockers } from "@/projects/storyboard/shot-video-precheck";
import {
  mapWithConcurrency,
  shouldGenerateShotVideo,
  STORYBOARD_VIDEO_CONCURRENCY,
  submitStoryboardShotVideo,
} from "@/projects/storyboard/services/storyboard-video-generate";
import {
  appendShotVideoHistory,
  appendStoryboardVideoHistory,
} from "@/projects/storyboard/video-history-ids";
import { readGenerationRecord } from "@/video-generation/generation-store";
import {
  paidGenerationAllowed,
  resolveVideoProviderRuntimeConfig,
} from "@/video-generation/provider/config";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

/**
 * POST 一键生成本集视频
 * Body: { storyboardRevision, idempotencyKey, includeSucceeded?, confirmPaidGeneration? }
 */
export async function POST(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;

  const videoGate = await requireActualProjectOwner(projectId);
  if (!videoGate.ok) return videoGate.response;

  const loaded = await loadAuthorizedWorkspace(projectId, videoGate.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  if (production.status !== "storyboard_done") {
    return NextResponse.json(
      { error: "请先确认本集分镜", code: "STORYBOARD_NOT_CONFIRMED" },
      { status: 400 },
    );
  }

  const storyboard = production.activeStoryboard;
  if (!storyboard || storyboard.status !== "confirmed") {
    return NextResponse.json(
      { error: "分镜尚未确认", code: "STORYBOARD_NOT_CONFIRMED" },
      { status: 400 },
    );
  }

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
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

  // 批次级幂等：相同 key 返回已有批次
  if (
    production.videoGenerationBatch?.batchId === idempotencyKey ||
    (production.videoGenerationBatch &&
      production.videoGenerationBatch.batchId.endsWith(idempotencyKey))
  ) {
    return NextResponse.json({
      batchId: production.videoGenerationBatch.batchId,
      shots: production.videoGenerationBatch.shots,
      production,
    });
  }

  const includeSucceeded = body.includeSucceeded === true;
  const confirmPaidGeneration = body.confirmPaidGeneration === true;
  let runtime;
  try {
    runtime = await resolveVideoProviderRuntimeConfig(undefined, {
      capabilityId: "video.storyboard-episode.generate",
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

  // 拒绝客户端提交真实供应商模型 ID
  if ("providerModelId" in body || "modelId" in body || "providerId" in body) {
    return NextResponse.json(
      { error: "不允许客户端指定 Provider 或模型", code: "CLIENT_MODEL_FORBIDDEN" },
      { status: 400 },
    );
  }

  const assets = await loadAssetBundleDraft(projectId);
  const validSceneIds = new Set((assets?.scenes ?? []).map((s) => s.id));
  const flat = listFlatShots(storyboard.scenes);

  const blockers = listShotVideoBlockers(
    flat.map((r) => r.shot),
    validSceneIds,
  );
  if (blockers.length > 0) {
    const first = blockers[0]!;
    return NextResponse.json(
      {
        error: first.message,
        firstBlockedShotId: first.shotId,
        code: first.code,
        blockers: blockers.map((b) => ({
          shotId: b.shotId,
          shotNumber: b.shotNumber,
          code: b.code,
          message: b.message,
        })),
      },
      { status: 400 },
    );
  }

  for (const row of flat) {
    if (!getShotVideoPrompt(row.shot)) {
      return NextResponse.json(
        {
          error: `镜头 ${row.shot.shotNumber} 缺少视频提示词`,
          firstBlockedShotId: row.shot.id,
          code: "MISSING_PROMPT",
        },
        { status: 400 },
      );
    }
  }

  const candidates: typeof flat = [];
  for (const row of flat) {
    const generation = row.shot.lastGenerationId
      ? await readGenerationRecord(row.shot.lastGenerationId)
      : null;
    if (
      shouldGenerateShotVideo({
        shot: row.shot,
        generation,
        includeSucceeded,
      })
    ) {
      candidates.push(row);
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        error: "没有需要生成的镜头（已成功且内容未变化的镜头默认跳过）",
        code: "NO_SHOTS_TO_GENERATE",
        batchId: null,
        shots: [],
      },
      { status: 400 },
    );
  }

  const batchId = `batch_${idempotencyKey}`;
  const results = await mapWithConcurrency(
    candidates,
    STORYBOARD_VIDEO_CONCURRENCY,
    async (row) => {
      const shotKey = `${idempotencyKey}:${row.shot.id}`;
      const submitted = await submitStoryboardShotVideo({
        projectId,
        shot: row.shot,
        assets,
        idempotencyKey: shotKey,
        confirmPaidGeneration,
        capabilityId: "video.storyboard-episode.generate",
      });
      if (!submitted.ok) {
        return {
          shotId: row.shot.id,
          generationId: null as string | null,
          status: "failed" as const,
          error: submitted.message,
          code: submitted.code,
          httpStatus: submitted.status ?? 400,
        };
      }
      return {
        shotId: row.shot.id,
        generationId: submitted.generation.id,
        status: submitted.generation.status,
        error: null as string | null,
        code: null as string | null,
        httpStatus: 200,
      };
    },
  );

  const firstBlocked = results.find((r) => r.generationId === null);
  if (firstBlocked && results.every((r) => r.generationId === null)) {
    return NextResponse.json(
      {
        error: firstBlocked.error ?? "批量提交失败",
        code: firstBlocked.code ?? "SUBMIT_FAILED",
        firstBlockedShotId: firstBlocked.shotId,
      },
      { status: firstBlocked.httpStatus ?? 400 },
    );
  }

  const now = new Date().toISOString();
  const shotGenMap = new Map(
    results
      .filter((r) => r.generationId)
      .map((r) => [r.shotId, r.generationId!]),
  );

  const nextScenes = storyboard.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      const generationId = shotGenMap.get(shot.id);
      if (!generationId) return shot;
      const withHistory = appendShotVideoHistory(shot, generationId);
      return {
        ...withHistory,
        videoContentStale: false,
        lastVideoContentHash: computeShotVideoContentHash(shot),
      };
    }),
  }));

  const batchShots = results
    .filter((r) => r.generationId)
    .map((r) => ({
      shotId: r.shotId,
      generationId: r.generationId!,
      status: r.status,
    }));

  const nextStoryboard = appendStoryboardVideoHistory(
    {
      ...storyboard,
      scenes: nextScenes,
      revision: storyboard.revision + 1,
      updatedAt: now,
    },
    batchShots.map((s) => s.generationId),
  );

  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextStoryboard,
    videoGenerationBatch: {
      batchId,
      storyboardRevision: storyboard.revision,
      includeSucceeded,
      createdAt: now,
      shots: batchShots,
    },
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    batchId,
    shots: batchShots,
    skippedCount: flat.length - candidates.length,
    failed: results.filter((r) => !r.generationId),
    production: updated,
  });
}
