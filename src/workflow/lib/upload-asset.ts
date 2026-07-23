export type AssetUploadResult = {
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "audio";
};

export async function uploadAssetFile(file: File): Promise<AssetUploadResult> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/api/assets", {
    method: "POST",
    body,
  });

  const payload = (await res.json()) as AssetUploadResult & { error?: string };
  if (!res.ok) {
    throw new Error(payload.error ?? "上传失败");
  }

  return {
    assetId: payload.assetId,
    assetUrl: payload.assetUrl,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    kind: payload.kind,
  };
}
