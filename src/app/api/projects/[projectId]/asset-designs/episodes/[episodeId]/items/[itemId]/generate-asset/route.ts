import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import { generateDesignAssetImage } from "@/projects/assets/episode-design/generate-design-asset-image";
import { deleteProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import {
  appendGeneratedMediaGenerations,
  appendPromptHistory,
} from "@/projects/assets/episode-design/generated-media-history";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";
import {
  parseIdempotencyKey,
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import { estimateAssetImageCredits } from "@/credits/generation-pricing";
import {
  DEFAULT_DESIGN_IMAGE_OPTIONS,
  parseDesignImageGenerationOptions,
} from "@/projects/assets/episode-design/image-generation-options";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

async function deleteBatchImages(projectId: string, mediaIds: string[]) {
  await Promise.all(
    mediaIds.map((mediaId) =>
      deleteProjectAssetImageFile(projectId, mediaId).catch(() => undefined),
    ),
  );
}

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
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
  if (
    raw &&
    ("stylePrompt" in raw ||
      "visualStyle" in raw ||
      "promptDirective" in raw)
  ) {
    return NextResponse.json(
      { error: "不允许客户端覆盖项目视觉风格" },
      { status: 400 },
    );
  }
  const idempotencyKey = parseIdempotencyKey(raw?.idempotencyKey);
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 idempotencyKey", code: "IDEMPOTENCY_KEY_REQUIRED" },
      { status: 400 },
    );
  }

  const hasOptionFields =
    raw != null &&
    ("quality" in raw || "aspectRatio" in raw || "count" in raw);
  const options = hasOptionFields
    ? parseDesignImageGenerationOptions(raw)
    : DEFAULT_DESIGN_IMAGE_OPTIONS;
  if (!options) {
    return NextResponse.json(
      {
        error: "画质、画面比例或生成张数无效（张数须为 1–4）",
        code: "INVALID_IMAGE_OPTIONS",
      },
      { status: 400 },
    );
  }

  const detail = await getEpisodeAssetDesignDetail(projectId, episodeId);
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
    count: options.count,
  });
  if (!reserved.ok) return reserved.response;

  let generated: Awaited<ReturnType<typeof generateDesignAssetImage>>;
  try {
    generated = await generateDesignAssetImage({
      projectId,
      assetType: item.assetType,
      assetName: item.name,
      prompt,
      quality: options.quality,
      aspectRatio: options.aspectRatio,
      count: options.count,
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

  const mediaIds = generated.images.map((image) => image.mediaId);
  const now = new Date().toISOString();
  const generatedMedia = appendGeneratedMediaGenerations(
    item.generatedMedia,
    generated.images.map((image) => ({
      mediaId: image.mediaId,
      prompt,
      generatedAt: now,
      promptFingerprint: generated.promptFingerprint,
      mimeType: image.mimeType,
    })),
  );

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

  let saved: Awaited<ReturnType<typeof saveEpisodeAssetDesignItems>>;
  try {
    saved = await saveEpisodeAssetDesignItems({
      projectId,
      episodeId,
      expectedRevision: detail.record.revision,
      fingerprint: detail.currentFingerprint,
      items: nextItems,
    });
  } catch (error) {
    await deleteBatchImages(projectId, mediaIds);
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId,
      reason: "asset-image-save-failed",
    });
    throw error;
  }
  if (!saved.ok) {
    await deleteBatchImages(projectId, mediaIds);
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

  const actualPoints = estimateAssetImageCredits(
    item.generatedMedia,
    generated.count,
  ).points;
  const credit = await settleGenerationCredits({
    reservationId: reserved.reservationId,
    projectId,
    actualPoints,
    reason: "asset-image-generation-settle",
    knownBalance: reserved.balance,
  });
  await syncManagementToWorkspace(projectId);

  return NextResponse.json({
    mediaId: generated.mediaId,
    mimeType: generated.mimeType,
    images: generated.images,
    mediaIds,
    previewKind: "image",
    mode: generated.mode,
    notice: `${generated.notice}。生成后请点「人物校验」上传至 SD 审核资产库`,
    aspectRatio: generated.aspectRatio,
    quality: generated.quality,
    count: generated.count,
    resolution: generated.resolution,
    generatedMedia,
    credit: {
      ...credit,
      firstGeneration: reserved.firstGeneration,
    },
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardEpisodeAssetDesignRemoteData(() => post(request, context));
}
