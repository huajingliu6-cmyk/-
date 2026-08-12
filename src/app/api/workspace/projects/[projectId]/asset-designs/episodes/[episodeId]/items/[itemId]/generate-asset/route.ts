import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { generateDesignAssetImage } from "@/projects/assets/episode-design/generate-design-asset-image";
import { deleteProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import {
  appendGeneratedMediaGeneration,
  appendPromptHistory,
} from "@/projects/assets/episode-design/generated-media-history";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  getWorkspaceEpisodeAssetDesignDetail,
  saveWorkspaceEpisodeAssetDesignItems,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";
import {
  parseIdempotencyKey,
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const prompt = typeof raw?.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
  }
  const idempotencyKey = parseIdempotencyKey(raw?.idempotencyKey);
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 idempotencyKey", code: "IDEMPOTENCY_KEY_REQUIRED" },
      { status: 400 },
    );
  }

  await ensureWorkspaceInitialized(projectId);
  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    projectId,
    episodeId,
  );
  if (!detail.ok) {
    return NextResponse.json(
      { error: detail.message, code: detail.code },
      { status: 404 },
    );
  }

  const item = detail.record.items.find((i) => i.id === itemId);
  if (!item) {
    return NextResponse.json({ error: "资产项不存在" }, { status: 404 });
  }

  if (item.assetType === "audio") {
    return NextResponse.json(
      {
        error: "当前未配置该类型的音频生成能力",
        code: "AUDIO_GENERATION_UNAVAILABLE",
      },
      { status: 403 },
    );
  }

  const reserved = await reserveImageGenerationCredits({
    projectId,
    actorUserId: gated.user.id,
    itemKey: `${episodeId}:${itemId}`,
    idempotencyKey,
    generatedMedia: item.generatedMedia,
  });
  if (!reserved.ok) return reserved.response;

  let generated: Awaited<ReturnType<typeof generateDesignAssetImage>>;
  try {
    generated = await generateDesignAssetImage({
      projectId,
      assetType: item.assetType,
      assetName: item.name,
      prompt,
    });
  } catch (error) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId,
      reason: "asset-image-provider-failed",
    });
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "IMAGE_GENERATION_FAILED";
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "资产生成失败",
        code,
      },
      { status },
    );
  }

  const now = new Date().toISOString();
  const generatedMedia = appendGeneratedMediaGeneration(item.generatedMedia, {
    mediaId: generated.mediaId,
    prompt,
    generatedAt: now,
    promptFingerprint: generated.promptFingerprint,
    mimeType: generated.mimeType,
  });

  const nextItems = detail.record.items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          designPrompt: {
            status: "ready" as const,
            text: prompt,
            generationId: i.designPrompt?.generationId ?? null,
            sourceFingerprint: i.designPrompt?.sourceFingerprint ?? null,
            generatedAt: i.designPrompt?.generatedAt ?? now,
            updatedAt: now,
            errorMessage: null,
            history: appendPromptHistory(i.designPrompt?.history, {
              text: prompt,
              generatedAt: now,
              generationId: i.designPrompt?.generationId ?? null,
              source: "generate_asset",
            }),
          },
          generatedMedia,
        }
      : i,
  );

  let saved: Awaited<ReturnType<typeof saveWorkspaceEpisodeAssetDesignItems>>;
  try {
    saved = await saveWorkspaceEpisodeAssetDesignItems({
      projectId,
      episodeId,
      expectedRevision: detail.record.revision,
      fingerprint: detail.currentFingerprint,
      items: nextItems,
    });
  } catch (error) {
    await deleteProjectAssetImageFile(projectId, generated.mediaId).catch(
      () => undefined,
    );
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId,
      reason: "asset-image-save-failed",
    });
    throw error;
  }
  if (!saved.ok) {
    await deleteProjectAssetImageFile(projectId, generated.mediaId).catch(
      () => undefined,
    );
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId,
      reason:
        saved.code === "REVISION_CONFLICT" || saved.code === "FINGERPRINT_STALE"
          ? "asset-image-revision-conflict"
          : "asset-image-save-rejected",
    });
    const status =
      saved.code === "REVISION_CONFLICT" || saved.code === "FINGERPRINT_STALE"
        ? 409
        : 400;
    return NextResponse.json(
      { error: saved.message, code: saved.code },
      { status },
    );
  }

  const credit = await settleGenerationCredits({
    reservationId: reserved.reservationId,
    projectId,
    actualPoints: reserved.points,
    reason: "asset-image-generation-settle",
    knownBalance: reserved.balance,
  });

  return NextResponse.json({
    mediaId: generated.mediaId,
    mimeType: generated.mimeType,
    previewKind: "image",
    mode: generated.mode,
    notice: `${generated.notice}。生成后请点「人物校验」上传至 SD 审核资产库`,
    aspectRatio: generated.aspectRatio,
    resolution: generated.resolution,
    generatedMedia,
    credit: {
      ...credit,
      firstGeneration: reserved.firstGeneration,
    },
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardWorkspaceRemoteData(() => post(request, context));
}
