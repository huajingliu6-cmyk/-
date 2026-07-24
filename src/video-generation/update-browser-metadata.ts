import type { GenerationRecord } from "./types";
import {
  readGenerationRecord,
  updateGenerationRecord,
} from "./generation-store";
import { ALLOWED_GENERATED_VIDEO_MIME } from "./classify-generation-result";
import { normalizeBrowserVideoMetadata } from "./normalize-browser-metadata";

export type UpdateBrowserMetadataInput = {
  generationId: string;
  videoAssetId: string;
  actualWidth: number;
  actualHeight: number;
  actualDurationSeconds: number;
};

export type UpdateBrowserMetadataResult =
  | { ok: true; generation: GenerationRecord; idempotent: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * 仅写回浏览器实测字段；不改 requested/provider/status。
 */
export async function updateGenerationBrowserMetadata(
  input: UpdateBrowserMetadataInput,
): Promise<UpdateBrowserMetadataResult> {
  const generation = await readGenerationRecord(input.generationId);
  if (!generation) {
    return {
      ok: false,
      status: 404,
      code: "GENERATION_NOT_FOUND",
      message: "生成任务不存在",
    };
  }

  if (generation.localVideoAssetId !== input.videoAssetId) {
    return {
      ok: false,
      status: 409,
      code: "ASSET_MISMATCH",
      message: "视频资产与当前任务不匹配",
    };
  }

  if (
    generation.resultAsset &&
    generation.resultAsset.id !== input.videoAssetId
  ) {
    return {
      ok: false,
      status: 409,
      code: "ASSET_MISMATCH",
      message: "结果资产与请求不一致",
    };
  }

  const asset = generation.resultAsset;
  if (!asset) {
    return {
      ok: false,
      status: 404,
      code: "ASSET_NOT_FOUND",
      message: "任务尚未登记视频资产",
    };
  }

  if (asset.assetType !== "generatedVideo") {
    return {
      ok: false,
      status: 415,
      code: "NOT_GENERATED_VIDEO",
      message: "仅允许为 generatedVideo 写回元数据",
    };
  }

  if (!ALLOWED_GENERATED_VIDEO_MIME.has(asset.mimeType)) {
    return {
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "不支持的视频类型",
    };
  }

  const normalized = normalizeBrowserVideoMetadata({
    width: input.actualWidth,
    height: input.actualHeight,
    duration: input.actualDurationSeconds,
  });
  if (!normalized.ok) {
    return {
      ok: false,
      status: 400,
      code: normalized.code,
      message: normalized.message,
    };
  }

  const {
    actualWidth,
    actualHeight,
    actualDurationSeconds,
  } = normalized.value;

  const same =
    generation.actualWidth === actualWidth &&
    generation.actualHeight === actualHeight &&
    generation.actualDurationSeconds === actualDurationSeconds &&
    generation.metadataSource === "browser";

  if (same) {
    return { ok: true, generation, idempotent: true };
  }

  // 显式只挑允许字段，避免误改 requested/provider/status
  const next = await updateGenerationRecord(input.generationId, {
    actualWidth,
    actualHeight,
    actualDurationSeconds,
    metadataSource: "browser",
  });

  return { ok: true, generation: next, idempotent: false };
}
