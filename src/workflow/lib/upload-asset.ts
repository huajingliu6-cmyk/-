import type { AssetRecord, AssetType } from "../types";

export type AssetUploadOptions = {
  assetType?: AssetType;
  name?: string;
  projectId?: string;
};

type AssetUploadApiResponse = {
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "audio";
  error?: string;
};

function inferAssetType(kind: "image" | "audio", assetType?: AssetType): AssetType {
  if (assetType) return assetType;
  return kind === "audio" ? "audio" : "referenceImage";
}

export async function uploadAssetFile(
  file: File,
  options: AssetUploadOptions = {},
): Promise<AssetRecord> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/api/assets", {
    method: "POST",
    body,
  });

  const payload = (await res.json()) as AssetUploadApiResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? "上传失败");
  }

  const now = new Date().toISOString();
  const projectId = options.projectId ?? "demo";
  const assetType = inferAssetType(payload.kind, options.assetType);
  const name = options.name ?? payload.fileName;
  const url = payload.assetUrl;

  return {
    id: payload.assetId,
    projectId,
    assetType,
    name,
    originalFileName: payload.fileName,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    url,
    thumbnailUrl: assetType === "audio" ? "" : url,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}
