import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { saveAssetFile } from "@/workflow/lib/asset-storage";
import type { AssetRecord } from "@/workflow/types";
import {
  FORBIDDEN_PLACEHOLDER_MP4_SHA256,
  hashBufferSha256,
  hashFileSha256,
} from "@/video-generation/validate-mock-video-source";

const VIDEO_DIR = path.join(process.cwd(), "data", "generated-videos");
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

async function ensureDir() {
  await fs.mkdir(VIDEO_DIR, { recursive: true });
}

function looksLikeHtml(buf: Buffer): boolean {
  const head = buf.subarray(0, 64).toString("utf8").toLowerCase();
  return head.includes("<!doctype") || head.includes("<html");
}

async function writeBufferAtomically(
  absolutePath: string,
  buffer: Buffer,
): Promise<{ sizeBytes: number; sha256: string }> {
  const tmp = `${absolutePath}.tmp`;
  await fs.writeFile(tmp, buffer);
  const sha256 = await hashBufferSha256(buffer);
  const statTmp = await fs.stat(tmp);
  if (statTmp.size !== buffer.byteLength) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new Error("转存写入后文件大小与缓冲区不一致");
  }
  await fs.rename(tmp, absolutePath);
  const statFinal = await fs.stat(absolutePath);
  if (statFinal.size !== buffer.byteLength) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw new Error("转存 rename 后文件大小不一致");
  }
  return { sizeBytes: statFinal.size, sha256 };
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

async function downloadHttpToBuffer(remoteUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
  contentLength: number | null;
}> {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`下载结果视频失败（HTTP ${res.status}）`);
  }
  const contentType = res.headers.get("content-type") || "";
  const contentLengthHeader = res.headers.get("content-length");
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : null;

  if (!res.body) {
    throw new Error("下载结果视频失败：响应体为空");
  }

  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > MAX_VIDEO_BYTES) {
      throw new Error("结果视频超过大小限制");
    }
    hash.update(chunk);
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks, total);

  if (
    contentLength != null &&
    Number.isFinite(contentLength) &&
    contentLength >= 0 &&
    buffer.byteLength !== contentLength
  ) {
    throw new Error(
      `转存截断：Content-Length=${contentLength}，实际写入=${buffer.byteLength}`,
    );
  }
  if (looksLikeHtml(buffer)) {
    throw new Error("结果地址返回了 HTML 错误页，而非视频文件");
  }
  if (
    contentType &&
    !contentType.includes("video") &&
    !contentType.includes("octet-stream") &&
    !contentType.includes("mp4")
  ) {
    throw new Error(`结果 Content-Type 异常：${contentType}`);
  }

  return {
    buffer,
    contentType: contentType || "video/mp4",
    contentLength,
  };
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
  const generatedRoot = path.resolve(VIDEO_DIR);
  // Mock 中间文件必须落在 data/generated-videos，防止任意 file:// 读取
  if (
    absolutePath !== generatedRoot &&
    !absolutePath.startsWith(generatedRoot + path.sep)
  ) {
    throw new Error("非法本地视频路径（仅允许 data/generated-videos）");
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

/**
 * 将 Provider 临时 URL 转存到开发环境本地磁盘。
 * 生产环境应改为 OSS / 对象存储。
 */
export async function transferRemoteVideoToLocal(params: {
  projectId: string;
  remoteVideoUrl: string;
  title: string;
  generationId: string;
  isMock?: boolean;
}): Promise<{
  asset: AssetRecord;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
}> {
  await ensureDir();

  let buffer: Buffer | null = null;
  let sourcePath: string | null = null;
  let expectedSize = 0;
  let expectedSha = "";
  let contentType = "video/mp4";

  if (params.remoteVideoUrl.startsWith("file://")) {
    const local = await readLocalFileUrl(params.remoteVideoUrl);
    sourcePath = local.absolutePath;
    expectedSize = local.sizeBytes;
    expectedSha = local.sha256;
    contentType = local.contentType;
  } else {
    const downloaded = await downloadHttpToBuffer(params.remoteVideoUrl);
    buffer = downloaded.buffer;
    expectedSize = buffer.byteLength;
    expectedSha = await hashBufferSha256(buffer);
    contentType = downloaded.contentType;
  }

  if (expectedSize <= 0) {
    throw new Error("转存文件大小为 0");
  }
  if (expectedSha === FORBIDDEN_PLACEHOLDER_MP4_SHA256) {
    throw new Error("拒绝转存旧版 98 B 伪 MP4 占位文件");
  }

  const id = randomUUID();
  const fileName = `${id}.mp4`;
  const absolutePath = path.join(VIDEO_DIR, fileName);

  let integrity: { sizeBytes: number; sha256: string };
  if (sourcePath) {
    integrity = await copyFileAtomically(
      sourcePath,
      absolutePath,
      expectedSize,
      expectedSha,
    );
    buffer = await fs.readFile(absolutePath);
  } else if (buffer) {
    integrity = await writeBufferAtomically(absolutePath, buffer);
  } else {
    throw new Error("转存缺少视频数据");
  }

  if (
    integrity.sizeBytes !== expectedSize ||
    integrity.sha256 !== expectedSha
  ) {
    await fs.unlink(absolutePath).catch(() => undefined);
    throw new Error("转存完整性校验失败，未创建资产记录");
  }

  const stored = await saveAssetFile({
    buffer,
    mimeType: contentType.includes("video") ? "video/mp4" : "video/mp4",
    fileName: `${params.title || "shot"}-${id}.mp4`,
    kind: "video",
    ext: ".mp4",
  });

  // sizeBytes 必须以最终资产文件 stat 为准
  const assetDisk = path.join(
    process.cwd(),
    "data",
    "assets",
    `${stored.assetId}.mp4`,
  );
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
