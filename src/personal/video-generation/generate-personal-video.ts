import "server-only";

import { randomUUID } from "crypto";
import { materialMediaUrl } from "@/materials/constants";
import { saveMaterialMedia } from "@/materials/media-store";
import { readFormDataImageFile } from "@/personal/form-data-image";
import {
  PERSONAL_VIDEO_DEFAULT_DURATION,
} from "@/personal/video-generation/constants";
import {
  providerModelIdForPersonalVideoChoice,
  resolvePersonalVideoOutputParams,
} from "@/personal/video-generation/personal-video-params";
import { personalVideoContentUrlFromRecord } from "@/personal/video-generation/content-url";
import { normalizePersonalVideoPosterUrl } from "@/personal/video-generation/poster-url";
import {
  isPersonalVideoReferenceBlocked,
  precheckPersonalVideoReferenceImage,
} from "@/personal/video-generation/precheck-reference";
import {
  newPersonalVideoHistoryId,
  personalVideoProjectId,
  prependPersonalVideoHistory,
} from "@/personal/video-generation/store";
import type { PersonalVideoHistoryItem } from "@/personal/video-generation/types";
import { refreshGenerationStatus, submitVideoGeneration } from "@/video-generation/service";
import { sanitizeGenerationForClient } from "@/video-generation/secure-transfer";
import type {
  GenerationAssetReference,
  GenerationRecord,
  VideoGenerationInput,
} from "@/video-generation/types";

export const PERSONAL_VIDEO_CAPABILITY_ID = "video.personal.generate" as const;

function mapRecordToHistoryItem(
  record: GenerationRecord,
  meta: {
    id: string;
    prompt: string;
    aspectRatio: PersonalVideoHistoryItem["aspectRatio"];
    durationSeconds: number;
    modelId: string;
    resolution: PersonalVideoHistoryItem["resolution"];
    stylePreset?: PersonalVideoHistoryItem["stylePreset"];
    generatedAt: string;
  },
): PersonalVideoHistoryItem {
  return {
    id: meta.id,
    generationId: record.id,
    prompt: meta.prompt,
    aspectRatio: meta.aspectRatio === "9:16" ? "9:16" : "16:9",
    durationSeconds: meta.durationSeconds,
    modelId: meta.modelId,
    resolution: meta.resolution,
    stylePreset: meta.stylePreset,
    status: record.status,
    videoUrl: personalVideoContentUrlFromRecord(record),
    posterUrl: normalizePersonalVideoPosterUrl(
      record.resultAsset?.thumbnailUrl ?? null,
      personalVideoContentUrlFromRecord(record),
    ),
    generatedAt: meta.generatedAt,
    errorMessage: record.errorMessage ?? undefined,
  };
}

export async function generatePersonalVideo(input: {
  userId: string;
  form: FormData;
}): Promise<{
  item: PersonalVideoHistoryItem;
  generation: ReturnType<typeof sanitizeGenerationForClient>;
}> {
  const prompt = String(input.form.get("prompt") ?? "").trim();
  if (!prompt) {
    throw Object.assign(new Error("请输入提示词"), {
      code: "PROMPT_REQUIRED",
      status: 400,
    });
  }

  const output = resolvePersonalVideoOutputParams(input.form);
  const providerModelId = providerModelIdForPersonalVideoChoice(
    output.modelChoice,
  );
  const projectId = personalVideoProjectId(input.userId);
  const shotId = `pshot_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const generatedAt = new Date().toISOString();
  const historyId = newPersonalVideoHistoryId();

  const referenceEntries = [
    ...input.form.getAll("image"),
    ...input.form.getAll("images"),
  ];

  const imageReferences: GenerationAssetReference[] = [];
  for (const entry of referenceEntries) {
    const parsed = await readFormDataImageFile(entry);
    if (!parsed) continue;

    const safety = await precheckPersonalVideoReferenceImage({
      buffer: parsed.buffer,
      mimeType: parsed.mime,
      label: parsed.fileName || "参考图",
    });
    if (isPersonalVideoReferenceBlocked(safety)) {
      throw Object.assign(
        new Error(safety.reason ?? "参考图未通过人物校验，无法生成视频"),
        { code: "VIDEO_REF_PRECHECK_BLOCKED", status: 400 },
      );
    }

    const saved = await saveMaterialMedia({
      buffer: parsed.buffer,
      declaredMime: parsed.mime,
    });
    const mediaId = saved.mediaId;
    imageReferences.push({
      assetId: mediaId,
      kind: "image",
      label: parsed.fileName || "参考图",
      mimeType: saved.mime,
      sourceUrl: materialMediaUrl(mediaId),
    });
  }

  const videoInput: VideoGenerationInput = {
    shotId,
    projectId,
    prompt,
    resolution: output.resolution,
    aspectRatio: output.aspectRatio,
    durationSeconds: output.durationSeconds || PERSONAL_VIDEO_DEFAULT_DURATION,
    watermark: false,
    promptExtend: true,
    characterReferences: [],
    sceneReferences: [],
    imageReferences,
    referenceVideos: [],
    orderedReferenceMedia: imageReferences,
    textInputs: [],
    referenceSelectionMode: imageReferences.length > 0 ? "manual" : "auto",
    selectedReferenceAssetIds: imageReferences.map((ref) => ref.assetId),
    directorSettings: output.stylePreset
      ? { stylePreset: output.stylePreset }
      : undefined,
  };

  const record = await submitVideoGeneration({
    input: videoInput,
    unsupportedAudioLabels: [],
    confirmPaidGeneration: true,
    capabilityId: PERSONAL_VIDEO_CAPABILITY_ID,
    modelIdOverride: providerModelId,
  });

  const refreshed = await refreshGenerationStatus(record.id, { force: true });
  const item = mapRecordToHistoryItem(refreshed, {
    id: historyId,
    prompt,
    aspectRatio: output.aspectRatio,
    durationSeconds: output.durationSeconds,
    modelId: providerModelId,
    resolution: output.resolution,
    stylePreset: output.stylePreset || undefined,
    generatedAt,
  });

  await prependPersonalVideoHistory(input.userId, item);

  return {
    item,
    generation: sanitizeGenerationForClient(refreshed),
  };
}

export async function refreshPersonalVideoHistoryItem(input: {
  userId: string;
  itemId: string;
}): Promise<PersonalVideoHistoryItem | null> {
  const { listPersonalVideoHistory, upsertPersonalVideoHistoryItem } =
    await import("@/personal/video-generation/store");
  const items = await listPersonalVideoHistory(input.userId);
  const existing = items.find(
    (item) => item.id === input.itemId || item.generationId === input.itemId,
  );
  if (!existing) return null;

  const refreshed = await refreshGenerationStatus(existing.generationId, {
    force: true,
  });
  const updated = mapRecordToHistoryItem(refreshed, {
    id: existing.id,
    prompt: existing.prompt,
    aspectRatio: existing.aspectRatio,
    durationSeconds: existing.durationSeconds,
    modelId: existing.modelId,
    resolution: existing.resolution,
    stylePreset: existing.stylePreset,
    generatedAt: existing.generatedAt,
  });
  await upsertPersonalVideoHistoryItem(input.userId, updated);
  return updated;
}
