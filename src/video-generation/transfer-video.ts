import { saveAssetFile } from "@/workflow/lib/asset-storage";
import type { AssetRecord } from "@/workflow/types";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const VIDEO_DIR = path.join(process.cwd(), "data", "generated-videos");
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

async function ensureDir() {
  await fs.mkdir(VIDEO_DIR, { recursive: true });
}

function looksLikeHtml(buf: Buffer): boolean {
  const head = buf.subarray(0, 64).toString("utf8").toLowerCase();
  return head.includes("<!doctype") || head.includes("<html");
}

async function downloadToBuffer(remoteUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  if (remoteUrl.startsWith("file://")) {
    let filePath = decodeURIComponent(remoteUrl.replace(/^file:\/\//, ""));
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
    const buffer = await fs.readFile(filePath);
    return { buffer, contentType: "video/mp4" };
  }

  const res = await fetch(remoteUrl);
  if (!res.ok) {
    throw new Error(`下载结果视频失败（HTTP ${res.status}）`);
  }
  const contentType = res.headers.get("content-type") || "";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_VIDEO_BYTES) {
    throw new Error("结果视频超过大小限制");
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
  return { buffer, contentType: contentType || "video/mp4" };
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
}): Promise<{ asset: AssetRecord; absolutePath: string }> {
  await ensureDir();
  const { buffer, contentType } = await downloadToBuffer(params.remoteVideoUrl);

  const id = randomUUID();
  const fileName = `${id}.mp4`;
  const absolutePath = path.join(VIDEO_DIR, fileName);
  const tmp = `${absolutePath}.tmp`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, absolutePath);

  const stored = await saveAssetFile({
    buffer,
    mimeType: contentType.includes("video") ? "video/mp4" : "video/mp4",
    fileName: `${params.title || "shot"}-${id}.mp4`,
    kind: "video",
    ext: ".mp4",
  });

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
    sizeBytes: stored.sizeBytes,
    url: stored.assetUrl,
    thumbnailUrl: stored.assetUrl,
    metadata: {
      source: params.isMock ? "mock-provider" : "provider-transfer",
      generationId: params.generationId,
      mock: Boolean(params.isMock),
      notice: params.isMock
        ? "Mock 演示结果，不是真实 AI 视频"
        : "开发环境本地转存；生产请使用对象存储",
    },
    createdAt: now,
    updatedAt: now,
  };

  return { asset, absolutePath };
}
