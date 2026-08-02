import { createReadStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import type { AssetRecord } from "@/workflow/types";
import { resolveAssetPath } from "@/workflow/lib/asset-storage";
import { readRemoteAssetFile } from "@/workflow/lib/asset-storage";
import { loadWorkflow } from "@/workflow/lib/workflow-storage";
import { readGenerationRecord } from "./generation-store";
import {
  ALLOWED_GENERATED_VIDEO_MIME,
  buildSafeVideoDownloadName,
} from "./classify-generation-result";
import { parseSingleByteRange } from "./parse-byte-range";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";

function assetsDir(): string {
  return resolveAppDataPath("assets");
}

export type ResolvedGeneratedVideoFile = {
  assetId: string;
  filePath: string;
  body: Buffer | null;
  mimeType: string;
  sizeBytes: number;
  asset: AssetRecord;
  isMock: boolean;
  downloadFileName: string;
};

export type ResolveGeneratedVideoError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

function isPathInsideAssetsDir(resolvedPath: string): boolean {
  const root = path.resolve(assetsDir());
  const normalized = path.resolve(resolvedPath);
  return (
    normalized === root || normalized.startsWith(root + path.sep)
  );
}

function rejectUnsafePathHints(value: string): boolean {
  if (value.includes("..")) return true;
  if (value.includes("\0")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith("\\\\") || value.startsWith("//")) return true;
  return false;
}

/**
 * 仅通过 assetId +（generationId 或 projectId）解析最终 generatedVideo。
 * 客户端不得提交 storagePath。
 */
export async function resolveGeneratedVideoForServe(params: {
  assetId: string;
  generationId?: string | null;
  projectId?: string | null;
  /** 客户端若传入 storagePath，一律拒绝 */
  clientStoragePath?: string | null;
  shotNumber?: number | null;
}): Promise<
  | { ok: true; value: ResolvedGeneratedVideoFile }
  | ResolveGeneratedVideoError
> {
  if (params.clientStoragePath) {
    return {
      ok: false,
      status: 400,
      code: "STORAGE_PATH_NOT_ALLOWED",
      message: "不允许由客户端指定存储路径",
    };
  }

  const assetId = params.assetId.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(assetId) || rejectUnsafePathHints(assetId)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_ASSET_ID",
      message: "无效的资产 ID",
    };
  }

  let asset: AssetRecord | null = null;
  let isMock = false;

  if (params.generationId) {
    if (rejectUnsafePathHints(params.generationId)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_GENERATION_ID",
        message: "无效的任务 ID",
      };
    }
    const record = await readGenerationRecord(params.generationId);
    if (!record) {
      return {
        ok: false,
        status: 404,
        code: "GENERATION_NOT_FOUND",
        message: "生成任务不存在",
      };
    }
    if (record.localVideoAssetId !== assetId) {
      return {
        ok: false,
        status: 409,
        code: "ASSET_MISMATCH",
        message: "视频资产与生成任务不匹配",
      };
    }
    if (record.resultAsset && record.resultAsset.id !== assetId) {
      return {
        ok: false,
        status: 409,
        code: "ASSET_MISMATCH",
        message: "结果资产与请求不一致",
      };
    }
    asset = record.resultAsset;
    isMock = record.isMock;
    if (!asset) {
      // 任务有 localVideoAssetId 但未内嵌 resultAsset 时，回退到工作流资产表
      const document = await loadWorkflow(record.projectId);
      asset =
        document.assets.find((a) => a.id === assetId) ?? null;
      if (!asset) {
        return {
          ok: false,
          status: 404,
          code: "ASSET_NOT_FOUND",
          message: "任务尚未登记视频资产",
        };
      }
    }
  } else if (params.projectId) {
    if (rejectUnsafePathHints(params.projectId)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_PROJECT_ID",
        message: "无效的项目 ID",
      };
    }
    const document = await loadWorkflow(params.projectId);
    asset = document.assets.find((a) => a.id === assetId) ?? null;
    if (!asset) {
      return {
        ok: false,
        status: 404,
        code: "ASSET_NOT_FOUND",
        message: "资产不存在",
      };
    }
    isMock = Boolean(asset.metadata?.mock);
  } else {
    return {
      ok: false,
      status: 400,
      code: "CONTEXT_REQUIRED",
      message: "播放生成视频需要 generationId 或 projectId",
    };
  }

  if (asset.assetType !== "generatedVideo") {
    return {
      ok: false,
      status: 415,
      code: "NOT_GENERATED_VIDEO",
      message: "仅允许播放 generatedVideo 资产",
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

  if (asset.mimeType.startsWith("image/")) {
    return {
      ok: false,
      status: 415,
      code: "IMAGE_NOT_VIDEO",
      message: "图片资产不能作为视频播放或下载",
    };
  }

  if (isRemoteDataOnly()) {
    const blob = await readRemoteAssetFile(assetId);
    if (!blob) {
      return { ok: false, status: 404, code: "FILE_MISSING", message: "视频文件不存在" };
    }
    if (blob.contentType !== "video/mp4") {
      return { ok: false, status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Blob 不是允许的视频类型" };
    }
    return {
      ok: true,
      value: {
        assetId,
        filePath: "",
        body: blob.body,
        mimeType: blob.contentType,
        sizeBytes: blob.body.byteLength,
        asset,
        isMock,
        downloadFileName: buildSafeVideoDownloadName({ isMock, shotNumber: params.shotNumber }),
      },
    };
  }

  const resolved = await resolveAssetPath(assetId);
  if (!resolved) {
    return {
      ok: false,
      status: 404,
      code: "FILE_MISSING",
      message: "视频文件不存在",
    };
  }

  if (!isPathInsideAssetsDir(resolved.filePath)) {
    return {
      ok: false,
      status: 400,
      code: "PATH_ESCAPE",
      message: "非法文件路径",
    };
  }

  if (resolved.mimeType !== "video/mp4") {
    return {
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "磁盘文件不是允许的视频类型",
    };
  }

  let sizeBytes = 0;
  try {
    const st = await fs.stat(resolved.filePath);
    sizeBytes = st.size;
  } catch {
    return {
      ok: false,
      status: 404,
      code: "FILE_MISSING",
      message: "视频文件不存在",
    };
  }

  return {
    ok: true,
    value: {
      assetId,
      filePath: resolved.filePath,
      body: null,
      mimeType: "video/mp4",
      sizeBytes,
      asset,
      isMock,
      downloadFileName: buildSafeVideoDownloadName({
        isMock,
        shotNumber: params.shotNumber,
      }),
    },
  };
}

export function buildVideoContentHeaders(params: {
  mimeType: string;
  sizeBytes: number;
  download?: boolean;
  downloadFileName?: string;
  contentRange?: string;
  contentLength: number;
}): Headers {
  const headers = new Headers();
  headers.set("Content-Type", params.mimeType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Length", String(params.contentLength));
  if (params.contentRange) {
    headers.set("Content-Range", params.contentRange);
  }
  if (params.download && params.downloadFileName) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${params.downloadFileName}"`,
    );
  } else {
    headers.set("Content-Disposition", "inline");
  }
  headers.set("Cache-Control", "private, max-age=3600");
  return headers;
}

export function openAssetReadStream(
  filePath: string,
  start?: number,
  end?: number,
): ReadableStream<Uint8Array> {
  const nodeStream =
    start != null && end != null
      ? createReadStream(filePath, { start, end })
      : createReadStream(filePath);
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

export function planAssetContentResponse(params: {
  rangeHeader: string | null;
  fileSize: number;
}):
  | {
      ok: true;
      status: 200 | 206;
      start: number | null;
      end: number | null;
      contentLength: number;
      contentRange?: string;
    }
  | { ok: false; status: 416; contentRange: string } {
  const parsed = parseSingleByteRange(params.rangeHeader, params.fileSize);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 416,
      contentRange: `bytes */${params.fileSize}`,
    };
  }
  if (parsed.range == null) {
    return {
      ok: true,
      status: 200,
      start: null,
      end: null,
      contentLength: params.fileSize,
    };
  }
  const { start, end, length } = parsed.range;
  return {
    ok: true,
    status: 206,
    start,
    end,
    contentLength: length,
    contentRange: `bytes ${start}-${end}/${params.fileSize}`,
  };
}
