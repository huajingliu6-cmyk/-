import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { saveAssetFile } from "@/workflow/lib/asset-storage";
import type { AssetRecord } from "@/workflow/types";
import type { GenerationRecord, VideoProviderId } from "./types";
import {
  FORBIDDEN_PLACEHOLDER_MP4_SHA256,
  hashFileSha256,
  validateMockVideoSource,
} from "@/video-generation/validate-mock-video-source";
import { buildTransferSourceFromGeneration } from "./secure-transfer/build-transfer-source";
import { TransferError } from "./secure-transfer/errors";
import {
  safeDownloadProviderVideoToBuffer,
  safeDownloadProviderVideoToTempFile,
  type SafeDownloadDeps,
} from "./secure-transfer/safe-download";
import type { TransferSource } from "./secure-transfer/types";
import { redactRemoteUrlForLogs } from "./secure-transfer/redact-url";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { hashBufferSha256 } from "@/video-generation/validate-mock-video-source";

import {
  deleteRemoteProviderResult,
  getRemoteProviderResult,
} from "@/video-generation/remote-provider-result";
import {
  bufferHasMp4Ftyp,
  isAcceptableProviderContentType,
  looksLikeHtmlOrXml,
  looksLikeJson,
} from "@/video-generation/secure-transfer/mp4-structure";
import { MAX_PROVIDER_VIDEO_BYTES } from "@/video-generation/secure-transfer/types";

function videoDir(): string {
  return resolveAppDataPath("generated-videos");
}

async function ensureDir() {
  await fs.mkdir(videoDir(), { recursive: true });
}

async function copyFileAtomically(
  sourcePath: string,
  absolutePath: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<{ sizeBytes: number; sha256: string }> {
  const tmp = `${absolutePath}.tmp`;
  await fs.copyFile(sourcePath, tmp);
  const statTmp = await fs.stat(tmp);
  if (statTmp.size !== expectedSize) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new Error(
      `转存临时文件大小不一致（期望 ${expectedSize}，实际 ${statTmp.size}）`,
    );
  }
  const shaTmp = await hashFileSha256(tmp);
  if (shaTmp !== expectedSha256) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new Error("转存临时文件 SHA-256 与源不一致（疑似截断）");
  }
  await fs.rename(tmp, absolutePath);
  const statFinal = await fs.stat(absolutePath);
  const shaFinal = await hashFileSha256(absolutePath);
  if (statFinal.size !== expectedSize || shaFinal !== expectedSha256) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw new Error("转存最终文件完整性校验失败");
  }
  return { sizeBytes: statFinal.size, sha256: shaFinal };
}

async function readLocalFileUrl(remoteUrl: string): Promise<{
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
}> {
  let filePath = decodeURIComponent(remoteUrl.replace(/^file:\/\//, ""));
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  const absolutePath = path.resolve(filePath);
  const generatedRoot = path.resolve(videoDir());
  const insideGeneratedRoot =
    absolutePath !== generatedRoot &&
    absolutePath.startsWith(generatedRoot + path.sep);
  if (!insideGeneratedRoot) {
    if (!isRemoteDataOnly()) {
      throw new Error("非法本地视频路径（仅允许 data/generated-videos）");
    }
    const validated = await validateMockVideoSource();
    if (!validated.ok || path.resolve(validated.absolutePath) !== absolutePath) {
      throw new Error("非法本地视频路径（仅允许已验证 Mock 源）");
    }
  }
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error("本地结果视频不存在或为空");
  }
  const sha256 = await hashFileSha256(absolutePath);
  if (sha256 === FORBIDDEN_PLACEHOLDER_MP4_SHA256) {
    throw new Error("拒绝转存旧版 98 B 伪 MP4 占位文件");
  }
  return {
    absolutePath,
    sizeBytes: stat.size,
    sha256,
    contentType: "video/mp4",
  };
}

async function finalizeAssetFromFile(params: {
  projectId: string;
  title: string;
  generationId: string;
  isMock: boolean;
  sourcePath: string;
  expectedSize: number;
  expectedSha: string;
}): Promise<{
  asset: AssetRecord;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
}> {
  const id = randomUUID();
  const fileName = `${id}.mp4`;
  const absolutePath = path.join(videoDir(), fileName);

  const integrity = await copyFileAtomically(
    params.sourcePath,
    absolutePath,
    params.expectedSize,
    params.expectedSha,
  );
  const buffer = await fs.readFile(absolutePath);

  if (
    integrity.sizeBytes !== params.expectedSize ||
    integrity.sha256 !== params.expectedSha
  ) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw new Error("转存完整性校验失败，未创建资产记录");
  }

  const stored = await saveAssetFile({
    buffer,
    mimeType: "video/mp4",
    fileName: `${params.title || "shot"}-${id}.mp4`,
    kind: "video",
    ext: ".mp4",
  });

  const assetDisk = resolveAppDataPath("assets", `${stored.assetId}.mp4`);
  const assetStat = await fs.stat(assetDisk);
  const assetSha = await hashFileSha256(assetDisk);
  if (
    assetStat.size !== integrity.sizeBytes ||
    assetSha !== integrity.sha256
  ) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw new Error("资产文件与转存结果不一致，已中止");
  }

  const now = new Date().toISOString();
  const asset: AssetRecord = {
    id: stored.assetId,
    projectId: params.projectId,
    assetType: "generatedVideo",
    name: params.isMock
      ? `${params.title || "镜头"}·Mock 演示结果`
      : `${params.title || "镜头"}·生成视频`,
    originalFileName: stored.fileName,
    mimeType: "video/mp4",
    sizeBytes: assetStat.size,
    url: stored.assetUrl,
    thumbnailUrl: stored.assetUrl,
    metadata: {
      source: params.isMock ? "mock-provider" : "provider-transfer",
      generationId: params.generationId,
      mock: Boolean(params.isMock),
      sha256: assetSha,
      notice: params.isMock
        ? "Mock 演示结果，不是真实 AI 视频"
        : "开发环境本地转存；生产请使用对象存储",
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    asset,
    absolutePath,
    sizeBytes: assetStat.size,
    sha256: assetSha,
  };
}

async function finalizeRemoteAssetFromBuffer(params: {
  projectId: string;
  title: string;
  generationId: string;
  isMock: boolean;
  buffer: Buffer;
  expectedSize: number;
  expectedSha: string;
}): Promise<{
  asset: AssetRecord;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
}> {
  if (
    params.buffer.byteLength !== params.expectedSize ||
    (await hashBufferSha256(params.buffer)) !== params.expectedSha
  ) {
    throw new Error("转存完整性校验失败，未创建资产记录");
  }
  const stored = await saveAssetFile({
    buffer: params.buffer,
    mimeType: "video/mp4",
    fileName: `${params.title || "shot"}-${randomUUID()}.mp4`,
    kind: "video",
    ext: ".mp4",
  });
  const now = new Date().toISOString();
  return {
    asset: {
      id: stored.assetId,
      projectId: params.projectId,
      assetType: "generatedVideo",
      name: params.isMock
        ? `${params.title || "镜头"}·Mock 演示结果`
        : `${params.title || "镜头"}·生成视频`,
      originalFileName: stored.fileName,
      mimeType: "video/mp4",
      sizeBytes: stored.sizeBytes,
      url: stored.assetUrl,
      thumbnailUrl: stored.assetUrl,
      metadata: {
        source: params.isMock ? "mock-provider" : "provider-transfer",
        generationId: params.generationId,
        mock: Boolean(params.isMock),
        sha256: params.expectedSha,
        notice: params.isMock
          ? "Mock 演示结果，不是真实 AI 视频"
          : "已转存到内网 Blob 服务",
      },
      createdAt: now,
      updatedAt: now,
    },
    absolutePath: `workflow-assets/${stored.assetId}`,
    sizeBytes: stored.sizeBytes,
    sha256: params.expectedSha,
  };
}

/**
 * 将 Provider 临时 URL / Mock 本地中间文件转存到开发环境本地磁盘。
 * 真实 Provider 必须走 TransferSource.providerHttps + SSRF 防护。
 * 生产环境应改为 OSS / 对象存储。
 */
export async function transferRemoteVideoToLocal(params: {
  projectId: string;
  title: string;
  generationId: string;
  providerId: VideoProviderId;
  isMock: boolean;
  remoteVideoUrl: string;
  /** 测试注入：DNS / HTTP transport */
  downloadDeps?: SafeDownloadDeps;
  /** 测试可直接传入已构建的 TransferSource；生产应由 GenerationRecord 派生 */
  source?: TransferSource;
}): Promise<{
  asset: AssetRecord;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
}> {
  const source =
    params.source ??
    buildTransferSourceFromGeneration({
      providerId: params.providerId,
      isMock: params.isMock,
      remoteVideoUrl: params.remoteVideoUrl,
    });

  if (source.kind === "mockFile") {
    const local = await readLocalFileUrl(source.fileUrl);
    if (isRemoteDataOnly()) {
      const buffer = await fs.readFile(local.absolutePath);
      return finalizeRemoteAssetFromBuffer({
        projectId: params.projectId,
        title: params.title,
        generationId: params.generationId,
        isMock: source.providerId === "mock",
        buffer,
        expectedSize: local.sizeBytes,
        expectedSha: local.sha256,
      });
    }
    await ensureDir();
    return finalizeAssetFromFile({
      projectId: params.projectId,
      title: params.title,
      generationId: params.generationId,
      isMock: source.providerId === "mock",
      sourcePath: local.absolutePath,
      expectedSize: local.sizeBytes,
      expectedSha: local.sha256,
    });
  }

  if (source.kind === "remoteProviderBlob") {
    if (!isRemoteDataOnly()) {
      throw new TransferError("TRANSFER_SOURCE_MISMATCH");
    }
    const remote = await getRemoteProviderResult(source.remoteBlobUrl);
    if (!remote) throw new TransferError("RESULT_TRANSFER_FAILED");
    if (remote.body.byteLength <= 0) {
      throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
    }
    if (remote.body.byteLength > MAX_PROVIDER_VIDEO_BYTES) {
      throw new TransferError("RESULT_FILE_TOO_LARGE");
    }
    if (isAcceptableProviderContentType(remote.contentType) === "reject") {
      throw new TransferError("RESULT_CONTENT_TYPE_INVALID");
    }
    if (
      looksLikeHtmlOrXml(remote.body) ||
      looksLikeJson(remote.body) ||
      !bufferHasMp4Ftyp(remote.body)
    ) {
      throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
    }
    const sha256 = await hashBufferSha256(remote.body);
    if (sha256 === FORBIDDEN_PLACEHOLDER_MP4_SHA256) {
      throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
    }
    const finalized = await finalizeRemoteAssetFromBuffer({
      projectId: params.projectId,
      title: params.title,
      generationId: params.generationId,
      isMock: false,
      buffer: remote.body,
      expectedSize: remote.body.byteLength,
      expectedSha: sha256,
    });
    await deleteRemoteProviderResult(source.remoteBlobUrl).catch(() => undefined);
    return finalized;
  }

  if (isRemoteDataOnly()) {
    const downloaded = await safeDownloadProviderVideoToBuffer({
      remoteUrl: source.remoteUrl,
      deps: params.downloadDeps,
    });
    if (downloaded.sha256 === FORBIDDEN_PLACEHOLDER_MP4_SHA256) {
      throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
    }
    return finalizeRemoteAssetFromBuffer({
      projectId: params.projectId,
      title: params.title,
      generationId: params.generationId,
      isMock: false,
      buffer: downloaded.buffer,
      expectedSize: downloaded.sizeBytes,
      expectedSha: downloaded.sha256,
    });
  }

  // providerHttps
  await ensureDir();
  const downloadId = randomUUID();
  const tempPath = path.join(videoDir(), `${downloadId}.download.tmp`);
  console.info(
    "[transfer] provider download start",
    redactRemoteUrlForLogs(source.remoteUrl),
  );

  let downloaded;
  try {
    downloaded = await safeDownloadProviderVideoToTempFile({
      remoteUrl: source.remoteUrl,
      tempPath,
      deps: params.downloadDeps,
    });
  } catch (err) {
    await fs.unlink(tempPath).catch(() => undefined);
    if (err instanceof TransferError) throw err;
    throw new TransferError(
      "RESULT_TRANSFER_FAILED",
      err instanceof Error ? err.message : "结果视频转存失败",
    );
  }

  if (downloaded.sha256 === FORBIDDEN_PLACEHOLDER_MP4_SHA256) {
    await fs.unlink(downloaded.absolutePath).catch(() => undefined);
    throw new TransferError("RESULT_VIDEO_STRUCTURE_INVALID");
  }

  try {
    const finalized = await finalizeAssetFromFile({
      projectId: params.projectId,
      title: params.title,
      generationId: params.generationId,
      isMock: false,
      sourcePath: downloaded.absolutePath,
      expectedSize: downloaded.sizeBytes,
      expectedSha: downloaded.sha256,
    });
    await fs.unlink(downloaded.absolutePath).catch(() => undefined);
    return finalized;
  } catch (err) {
    await fs.unlink(downloaded.absolutePath).catch(() => undefined);
    throw err;
  }
}

/** 从完整 GenerationRecord 转存（推荐入口） */
export async function transferGenerationResultToLocal(
  record: GenerationRecord,
  options?: { title?: string; downloadDeps?: SafeDownloadDeps },
): Promise<{
  asset: AssetRecord;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
}> {
  if (!record.remoteVideoUrl) {
    throw new TransferError("NO_REMOTE_URL");
  }
  return transferRemoteVideoToLocal({
    projectId: record.projectId,
    title: options?.title ?? "镜头",
    generationId: record.id,
    providerId: record.providerId,
    isMock: record.isMock,
    remoteVideoUrl: record.remoteVideoUrl,
    downloadDeps: options?.downloadDeps,
  });
}
