import "server-only";

import { NextResponse } from "next/server";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { createAndEnqueueImageJob } from "@/projects/assets/image-generation/process-job";
import { publicImageJobView } from "@/projects/assets/image-generation/public-view";
import {
  isItemGeneratedMediaId,
  parseGenerateAssetRequest,
} from "@/projects/assets/episode-design/parse-generate-asset-request";
import { buildMultiAngleEditPrompt } from "@/projects/assets/episode-design/multi-angle-prompts";
import { readProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import {
  releaseGenerationCredits,
  reserveImageGenerationCredits,
} from "@/credits/generation-billing";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

/**
 * Shared async enqueue for DesignAssetModal generate-asset routes.
 * Returns img_* job; does not wait on 3080.
 */
export async function enqueueDesignAssetGenerate(input: {
  request: Request;
  projectId: string;
  episodeId: string;
  itemId: string;
  actorUserId: string;
  scope: AssetBundleStoreScope;
  item: EpisodeAssetDesignItem;
}): Promise<NextResponse> {
  const parsed = await parseGenerateAssetRequest(input.request);
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

  if (input.item.assetType === "audio") {
    return NextResponse.json(
      {
        error: "当前未配置该类型的音频生成能力",
        code: "AUDIO_GENERATION_UNAVAILABLE",
      },
      { status: 403 },
    );
  }

  if (multiAngleMode && input.item.assetType !== "scene") {
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
  const libraryReferenceMediaIds: string[] = [];

  if (mode === "image_to_image") {
    for (const slot of referenceSlots) {
      if (slot.kind === "upload") {
        referenceImages.push(slot.image);
        continue;
      }
      if (slot.kind !== "media") {
        return NextResponse.json(
          {
            error: "当前生成入口不支持素材库参考图",
            code: "REFERENCE_SOURCE_UNSUPPORTED",
          },
          { status: 400 },
        );
      }
      if (!isItemGeneratedMediaId(input.item, slot.mediaId)) {
        return NextResponse.json(
          {
            error: "参考图必须属于当前资产的已生成图片",
            code: "REFERENCE_MEDIA_FORBIDDEN",
          },
          { status: 403 },
        );
      }
      const file = await readProjectAssetImageFile(
        input.projectId,
        slot.mediaId,
      );
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
      libraryReferenceMediaIds.push(slot.mediaId);
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
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    itemKey: `${input.episodeId}:${input.itemId}`,
    idempotencyKey,
    generatedMedia: input.item.generatedMedia,
    count: options.count,
  });
  if (!reserved.ok) return reserved.response;

  const assetKind =
    input.item.assetType === "character" ||
    input.item.assetType === "scene" ||
    input.item.assetType === "prop"
      ? input.item.assetType
      : "character";

  const enqueued = await createAndEnqueueImageJob({
    projectId: input.projectId,
    scope: input.scope,
    subjectKind: "design_item",
    subjectId: input.itemId,
    assetKind,
    episodeId: input.episodeId,
    actorUserId: input.actorUserId,
    params: {
      prompt,
      mode,
      model: requestedModel,
      quality: options.quality,
      aspectRatio: options.aspectRatio,
      count: options.count,
      multiAngleMode: multiAngleMode ?? null,
      referenceMediaIds: libraryReferenceMediaIds,
    },
    idempotencyKey,
    creditReservationId: reserved.reservationId,
    referenceImages,
    effectivePrompt,
    model: requestedModel,
    sourceEntry: "design_item",
    libraryReferenceMediaIds,
  });

  if (!enqueued.ok) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "design-asset-image-duplicate-blocked",
    });
    return NextResponse.json(
      {
        error: enqueued.message,
        code: enqueued.code,
        job: enqueued.job ? publicImageJobView(enqueued.job) : null,
      },
      { status: enqueued.status },
    );
  }

  if (enqueued.reusedIdempotency) {
    await releaseGenerationCredits({
      reservationId: reserved.reservationId,
      projectId: input.projectId,
      reason: "design-asset-image-idempotent-reuse",
    });
  }

  return NextResponse.json({
    async: true,
    jobId: enqueued.job.id,
    job: publicImageJobView(enqueued.job),
    notice: "已提交生成任务，预计进度见下方。生成完成后请点「人物校验」。",
  });
}
