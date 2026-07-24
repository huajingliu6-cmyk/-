import type { AssetRecord } from "@/workflow/types";
import type { GenerationRecord } from "./types";

export const ALLOWED_GENERATED_VIDEO_MIME = new Set(["video/mp4"]);

export type GenerationResultKind =
  | "noResult"
  | "queued"
  | "processing"
  | "transferFailed"
  | "mockVideo"
  | "providerVideo"
  | "invalidVideoAsset"
  | "missingVideoFile"
  | "failed"
  | "cancelled";

export type ClassifiedGenerationResult = {
  kind: GenerationResultKind;
  label: string;
  message: string;
  canPlay: boolean;
  canDownload: boolean;
  isMock: boolean;
  videoAsset: AssetRecord | null;
};

function isImageMime(mime: string): boolean {
  return (
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/webp"
  );
}

function isAllowedVideoAsset(asset: AssetRecord | null | undefined): boolean {
  if (!asset) return false;
  if (asset.assetType !== "generatedVideo") return false;
  if (!ALLOWED_GENERATED_VIDEO_MIME.has(asset.mimeType)) return false;
  if (isImageMime(asset.mimeType)) return false;
  return true;
}

/**
 * 严格区分 Mock / 真实 Provider / 图片冒充 / 转存失败 / 无结果等。
 * 不把 PNG/JPG/WEBP 识别为视频，不回退演示图。
 */
export function classifyGenerationResult(params: {
  generation: GenerationRecord | null | undefined;
  asset: AssetRecord | null | undefined;
}): ClassifiedGenerationResult {
  const { generation, asset } = params;

  if (!generation) {
    if (!asset) {
      return {
        kind: "noResult",
        label: "无结果",
        message: "尚未生成视频",
        canPlay: false,
        canDownload: false,
        isMock: false,
        videoAsset: null,
      };
    }
    if (isAllowedVideoAsset(asset)) {
      const isMock = Boolean(asset.metadata?.mock);
      return {
        kind: isMock ? "mockVideo" : "providerVideo",
        label: isMock ? "Mock 视频" : "生成视频",
        message: isMock
          ? "Mock 演示视频，不是真实 AI 生成结果"
          : "已生成视频",
        canPlay: true,
        canDownload: true,
        isMock,
        videoAsset: asset,
      };
    }
    if (isImageMime(asset.mimeType) || asset.assetType !== "generatedVideo") {
      return {
        kind: "invalidVideoAsset",
        label: "数据异常",
        message: "结果不是有效的生成视频资产，不能当作视频播放",
        canPlay: false,
        canDownload: false,
        isMock: false,
        videoAsset: null,
      };
    }
    return {
      kind: "invalidVideoAsset",
      label: "数据异常",
      message: "视频资产数据异常",
      canPlay: false,
      canDownload: false,
      isMock: false,
      videoAsset: null,
    };
  }

  const status = generation.status;

  if (status === "queued" || status === "validating") {
    return {
      kind: "queued",
      label: "排队中",
      message: generation.progressLabel || "任务排队中",
      canPlay: false,
      canDownload: false,
      isMock: generation.isMock,
      videoAsset: null,
    };
  }

  if (status === "processing" || status === "downloading") {
    return {
      kind: "processing",
      label: "处理中",
      message: generation.progressLabel || "正在生成或转存",
      canPlay: false,
      canDownload: false,
      isMock: generation.isMock,
      videoAsset: null,
    };
  }

  if (status === "cancelled") {
    return {
      kind: "cancelled",
      label: "已取消",
      message: generation.errorMessage || "任务已取消",
      canPlay: false,
      canDownload: false,
      isMock: generation.isMock,
      videoAsset: null,
    };
  }

  if (status === "failed") {
    return {
      kind: "failed",
      label: "失败",
      message: generation.errorMessage || "生成失败",
      canPlay: false,
      canDownload: false,
      isMock: generation.isMock,
      videoAsset: null,
    };
  }

  if (status === "resultTransferFailed") {
    return {
      kind: "transferFailed",
      label: "转存失败",
      message: "视频已生成，但本地转存失败",
      canPlay: false,
      canDownload: false,
      isMock: generation.isMock,
      videoAsset: null,
    };
  }

  if (status === "completed") {
    const localId = generation.localVideoAssetId;
    const resultAsset = generation.resultAsset;
    const resolved =
      asset && localId && asset.id === localId
        ? asset
        : resultAsset && localId && resultAsset.id === localId
          ? resultAsset
          : asset ?? resultAsset;

    if (!localId || !resolved) {
      return {
        kind: "invalidVideoAsset",
        label: "数据异常",
        message: "任务已完成，但缺少有效的生成视频资产",
        canPlay: false,
        canDownload: false,
        isMock: generation.isMock,
        videoAsset: null,
      };
    }

    if (
      isImageMime(resolved.mimeType) ||
      resolved.assetType !== "generatedVideo" ||
      !ALLOWED_GENERATED_VIDEO_MIME.has(resolved.mimeType)
    ) {
      return {
        kind: "invalidVideoAsset",
        label: "数据异常",
        message: "完成结果不是有效视频（禁止将图片当作视频）",
        canPlay: false,
        canDownload: false,
        isMock: generation.isMock,
        videoAsset: null,
      };
    }

    if (generation.isMock) {
      return {
        kind: "mockVideo",
        label: "Mock 视频",
        message: "Mock 演示视频，不是真实 AI 生成结果",
        canPlay: true,
        canDownload: true,
        isMock: true,
        videoAsset: resolved,
      };
    }

    return {
      kind: "providerVideo",
      label: "生成视频",
      message: "已生成视频",
      canPlay: true,
      canDownload: true,
      isMock: false,
      videoAsset: resolved,
    };
  }

  return {
    kind: "noResult",
    label: "无结果",
    message: "尚未生成视频",
    canPlay: false,
    canDownload: false,
    isMock: generation.isMock,
    videoAsset: null,
  };
}

export function formatVideoFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "未知";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 安全下载文件名（不含用户任意标题注入） */
export function buildSafeVideoDownloadName(params: {
  isMock: boolean;
  shotNumber?: number | null;
}): string {
  const n =
    typeof params.shotNumber === "number" &&
    Number.isFinite(params.shotNumber) &&
    params.shotNumber > 0
      ? Math.floor(params.shotNumber)
      : 1;
  const padded = String(n).padStart(3, "0");
  return params.isMock ? `mock-shot-${padded}.mp4` : `shot-${padded}.mp4`;
}
