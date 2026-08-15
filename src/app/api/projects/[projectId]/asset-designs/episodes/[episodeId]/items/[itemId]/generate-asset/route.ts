import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import { generateDesignAssetImage } from "@/projects/assets/episode-design/generate-design-asset-image";
import {
  deleteProjectAssetImageFile,
  readProjectAssetImageFile,
} from "@/projects/assets/asset-image-storage";
import {
  appendGeneratedMediaGenerations,
  appendPromptHistory,
} from "@/projects/assets/episode-design/generated-media-history";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";
import {
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import { estimateAssetImageCredits } from "@/credits/generation-pricing";
import {
  isItemGeneratedMediaId,
  parseGenerateAssetRequest,
} from "@/projects/assets/episode-design/parse-generate-asset-request";
import { buildMultiAngleEditPrompt } from "@/projects/assets/episode-design/multi-angle-prompts";

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

  const parsed = await parseGenerateAssetRequest(request);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error.error,
        ...(parsed.error.code ? { code: parsed.error.code } : {}),
      },
      { status: parsed.error.status },
    );
  }

  const {
    mode,
    prompt,
    idempotencyKey,
    options,
    model: requestedModel,
    multiAngleMode,
  } = parsed.value;

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

  if (multiAngleMode && item.assetType !== "scene") {
    return NextResponse.json(
      {
        error: "多角度生图仅支持场景资产",
        code: "MULTI_ANGLE_SCENE_ONLY",
      },
      { status: 400 },
    );
  }

  const referenceSlots = multiAngleMode
    ? parsed.value.referenceSlots.slice(0, 1)
    : parsed.value.referenceSlots;
  const referenceImages: Array<{
    buffer: Buffer;
    mimeType: import("@/projects/assets/asset-image-storage").ProjectAssetImageMime;
    fileName: string;
  }> = [];
  if (mode === "image_to_image") {
    for (const slot of referenceSlots) {
      if (slot.kind === "upload") {
        referenceImages.push(slot.image);
        continue;
      }
      if (!isItemGeneratedMediaId(item, slot.mediaId)) {
        return NextResponse.json(
          {
            error: "参考图必须属于当前资产的已生成图片",
            code: "REFERENCE_MEDIA_FORBIDDEN",
          },
          { status: 403 },
        );
      }
      const file = await readProjectAssetImageFile(projectId, slot.mediaId);
      if (!file) {
        return NextResponse.json(
          {
            error: "无法读取参考图片",
            code: "REFERENCE_IMAGE_NOT_FOUND",
          },
          { status: 404 },
        );
      }
      referenceImages.push(file);
    }
    if (referenceImages.length === 0) {
      return NextResponse.json(
        {
          error: multiAngleMode
            ? "请先生成或上传场景参考图"
            : "图生图至少需要 1 张参考图",
          code: "REFERENCE_IMAGE_REQUIRED",
        },
        { status: 400 },
      );
    }
  }

  const effectivePrompt = multiAngleMode
    ? buildMultiAngleEditPrompt(multiAngleMode, prompt)
    : prompt;

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
      prompt: effectivePrompt,
      quality: options.quality,
      aspectRatio: options.aspectRatio,
      count: options.count,
      model: requestedModel,
      useRawPrompt: Boolean(multiAngleMode),
      ...(mode === "image_to_image"
        ? { referenceImages }
        : {}),
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
      prompt: effectivePrompt,
      generatedAt: now,
      promptFingerprint: generated.promptFingerprint,
      mimeType: image.mimeType,
    })),
  );

  const nextItems = detail.record.items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          designPrompt:
            mode === "image_to_image"
              ? i.designPrompt
              : {
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
