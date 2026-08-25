import {
  PROJECT_ASSET_AUDIO_ACCEPT,
  PROJECT_ASSET_AUDIO_MAX_BYTES,
} from "@/projects/assets/asset-audio-constants";
import {
  validateVoiceAudioFileClient,
  validateVoiceAudioMimeAndSize,
} from "@/projects/assets/voice-audio-validation";

export type UploadProjectAssetAudioResult = {
  assetId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export class ProjectAssetAudioUploadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectAssetAudioUploadError";
    this.status = status;
  }
}

const ALLOWED_EXT = /\.(mp3|wav|ogg)$/i;

export function validateProjectAssetAudioFileClient(
  file: File,
  options?: { variant?: "default" | "voice" },
): string | null {
  if (options?.variant === "voice") {
    return validateVoiceAudioMimeAndSize(file);
  }
  if (file.size <= 0) {
    return "音频文件为空";
  }
  if (file.size > PROJECT_ASSET_AUDIO_MAX_BYTES) {
    return "音频不能超过 50MB";
  }
  const type = (file.type || "").toLowerCase();
  const okType =
    type === "" ||
    type === "application/octet-stream" ||
    type === "audio/mpeg" ||
    type === "audio/mp3" ||
    type === "audio/wav" ||
    type === "audio/x-wav" ||
    type === "audio/wave" ||
    type === "audio/ogg" ||
    type.startsWith("audio/");
  if (!okType || !ALLOWED_EXT.test(file.name)) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  if (/\.(m4a|aac|flac|wma|aiff|webm|mp4|html?|pdf|png|jpe?g|gif|zip|exe)$/i.test(file.name)) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  if (
    type &&
    type !== "application/octet-stream" &&
    !type.startsWith("audio/") &&
    type !== ""
  ) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  // Reject known non-supported audio subtypes when extension also wrong-ish
  if (
    type === "audio/mp4" ||
    type === "audio/aac" ||
    type === "audio/x-m4a" ||
    type === "audio/flac" ||
    type === "audio/webm"
  ) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  return null;
}

export { PROJECT_ASSET_AUDIO_ACCEPT };

export async function uploadProjectAssetAudio(
  projectId: string,
  assetId: string,
  file: File,
): Promise<UploadProjectAssetAudioResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/assets-draft/audio/${encodeURIComponent(assetId)}`,
    { method: "PUT", body: form },
  );
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    assetId?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  };
  if (!res.ok) {
    throw new ProjectAssetAudioUploadError(
      payload.error ?? "上传音频失败",
      res.status,
    );
  }
  if (
    !payload.assetId ||
    !payload.fileName ||
    !payload.mimeType ||
    typeof payload.sizeBytes !== "number"
  ) {
    throw new ProjectAssetAudioUploadError("上传响应无效", 500);
  }
  return {
    assetId: payload.assetId,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
  };
}

export async function deleteProjectAssetAudio(
  projectId: string,
  assetId: string,
  options?: { hard?: boolean },
): Promise<void> {
  const hardQuery = options?.hard ? "?hard=1" : "";
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/assets-draft/audio/${encodeURIComponent(assetId)}${hardQuery}`,
    {
      method: "DELETE",
      ...(options?.hard
        ? { headers: { "X-Hard-Delete": "1" } }
        : {}),
    },
  );
  if (res.status === 404) return;
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ProjectAssetAudioUploadError(
      payload.error ?? (options?.hard ? "删除音色失败" : "清除音频失败"),
      res.status,
    );
  }
}

/**
 * Persist asset row first, then upload bytes. Used by create flows so unknown
 * assetIds never hit the upload route.
 */
export async function persistThenUploadAssetAudio(params: {
  projectId: string;
  assetId: string;
  pendingFile: File | null | undefined;
  persist: () => Promise<void>;
}): Promise<UploadProjectAssetAudioResult | null> {
  await params.persist();
  if (!params.pendingFile) return null;
  return uploadProjectAssetAudio(
    params.projectId,
    params.assetId,
    params.pendingFile,
  );
}
