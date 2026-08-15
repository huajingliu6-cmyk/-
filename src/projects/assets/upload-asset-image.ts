import {
  PROJECT_ASSET_IMAGE_MAX_BYTES,
  PROJECT_ASSET_IMAGE_MIME,
} from "@/projects/assets/asset-image-constants";

export type UploadProjectAssetImageResult = {
  assetId: string;
  imageFileName: string;
  imageMimeType: string;
  sizeBytes: number;
};

export class ProjectAssetImageUploadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectAssetImageUploadError";
    this.status = status;
  }
}

const ALLOWED_CLIENT_MIME = new Set<string>(PROJECT_ASSET_IMAGE_MIME);

export function validateProjectAssetImageFileClient(file: File): string | null {
  if (file.size > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return "图片不能超过 10MB";
  }
  const type = (file.type || "").toLowerCase();
  const okType =
    ALLOWED_CLIENT_MIME.has(type) ||
    (type === "" && /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!okType) {
    return "请上传 PNG / JPEG / WEBP 图片";
  }
  if (/\.(svg|gif|html?|pdf|exe|dll|js)$/i.test(file.name)) {
    return "请上传 PNG / JPEG / WEBP 图片";
  }
  return null;
}

export async function uploadProjectAssetImage(
  projectId: string,
  assetId: string,
  file: File,
  options?: { targetMediaId?: string | null },
): Promise<UploadProjectAssetImageResult> {
  const form = new FormData();
  form.append("file", file);
  const targetMediaId = options?.targetMediaId?.trim();
  const query = targetMediaId
    ? `?targetMediaId=${encodeURIComponent(targetMediaId)}`
    : "";
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/assets-draft/images/${encodeURIComponent(assetId)}${query}`,
    { method: "PUT", body: form },
  );
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    assetId?: string;
    imageFileName?: string;
    imageMimeType?: string;
    sizeBytes?: number;
  };
  if (!res.ok) {
    throw new ProjectAssetImageUploadError(
      payload.error ?? "上传图片失败",
      res.status,
    );
  }
  if (
    !payload.assetId ||
    !payload.imageFileName ||
    !payload.imageMimeType ||
    typeof payload.sizeBytes !== "number"
  ) {
    throw new ProjectAssetImageUploadError("上传响应无效", 500);
  }
  return {
    assetId: payload.assetId,
    imageFileName: payload.imageFileName,
    imageMimeType: payload.imageMimeType,
    sizeBytes: payload.sizeBytes,
  };
}

export async function deleteProjectAssetImage(
  projectId: string,
  assetId: string,
): Promise<void> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/assets-draft/images/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
  );
  if (res.status === 404) return;
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ProjectAssetImageUploadError(
      payload.error ?? "清除图片失败",
      res.status,
    );
  }
}

/**
 * Persist asset row first, then upload bytes. Used by create flows so unknown
 * assetIds never hit the upload route.
 */
export async function persistThenUploadAssetImage(params: {
  projectId: string;
  assetId: string;
  pendingFile: File | null | undefined;
  persist: () => Promise<void>;
}): Promise<UploadProjectAssetImageResult | null> {
  await params.persist();
  if (!params.pendingFile) return null;
  return uploadProjectAssetImage(
    params.projectId,
    params.assetId,
    params.pendingFile,
  );
}
