import { promises as fs } from "fs";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import type { GeneratedMediaState } from "@/projects/assets/episode-design/types";
import type { VideoRefSafety } from "@/projects/assets/types";
import {
  resolveAssetImageFilePath,
  readProjectAssetImageMeta,
} from "@/projects/assets/asset-image-storage";
import { getRemoteAssetImage } from "@/projects/assets/remote-asset-blob-store";
import {
  sd2CertFailedSafety,
  sd2CertOkSafety,
  sd2CertRejectedSafety,
} from "@/video-generation/sd2-cert-safety";
import { materializeSd2AssetRef } from "@/video-generation/provider/sd2-platform-client";
import { resolveSd2PlatformCredentials } from "@/video-generation/provider/sd2-platform-config";
import { isSd2RealPersonCertError } from "@/video-generation/user-facing-error";

export {
  formatDesignVideoRefSafetyNotice,
  designVideoRefSafetyBadge,
  isDesignMediaVideoRefLocked,
} from "@/projects/assets/episode-design/design-media-video-ref-labels";

export { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

/** Attach Seedance video-ref precheck result onto generated-media state. */
export function withGeneratedMediaVideoRefSafety(
  media: GeneratedMediaState,
  safety: VideoRefSafety,
): GeneratedMediaState {
  const currentId = media.currentId?.trim() || null;
  const history = (media.history ?? []).map((entry) =>
    currentId && entry.mediaId === currentId
      ? { ...entry, videoRefSafety: safety }
      : entry,
  );
  return {
    ...media,
    videoRefSafety: safety,
    ...(history.length > 0 ? { history } : {}),
  };
}

/** 取某张生成图已有的校验结果（含 history）。 */
export function getDesignMediaVideoRefSafety(
  media: GeneratedMediaState | null | undefined,
  mediaId: string,
): VideoRefSafety | null {
  const id = mediaId.trim();
  if (!media || !id) return null;
  const fromHistory = media.history?.find((h) => h.mediaId === id)?.videoRefSafety;
  if (fromHistory) return fromHistory;
  if (media.currentId === id && media.videoRefSafety) {
    return media.videoRefSafety;
  }
  return null;
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "";
}

/**
 * 设计素材「人物校验」：走移动 SD2 真人认证上传线路。
 * - active → ok（绿盾，可锁定）
 * - failed / blocked → likely_real_person（疑似真人）
 * - 超时 / 配置 / 网络 → check_failed
 *
 * 凭证：优先「管理 API → 移动 SD2 平台」，可与方舟视频镜头并存。
 */
export async function precheckDesignGeneratedMedia(params: {
  projectId: string;
  mediaId: string;
  fetchImpl?: typeof fetch;
  label?: string;
}): Promise<VideoRefSafety> {
  const mediaId = params.mediaId.trim();
  if (!mediaId) {
    return sd2CertFailedSafety("无效的图片标识");
  }

  const creds = await resolveSd2PlatformCredentials();
  if ("error" in creds) {
    return sd2CertFailedSafety(creds.error);
  }

  let dataUrl: string;
  if (isRemoteDataOnly()) {
    const blob = await getRemoteAssetImage(params.projectId, mediaId);
    if (!blob) return sd2CertFailedSafety("无法读取生成图文件");
    dataUrl = `data:${blob.contentType};base64,${blob.body.toString("base64")}`;
  } else {
    const filePath = resolveAssetImageFilePath(params.projectId, mediaId);
    if (!filePath) {
      return sd2CertFailedSafety("无效的图片标识");
    }
    try {
      const buf = await fs.readFile(filePath);
      const meta = await readProjectAssetImageMeta(params.projectId, mediaId);
      const mimeType = meta?.mimeType || "image/png";
      dataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
    } catch {
      return sd2CertFailedSafety("无法读取生成图文件");
    }
  }

  try {
    await materializeSd2AssetRef({
      apiUrl: creds.apiUrl,
      apiKey: creds.apiKey,
      sourceUrl: dataUrl,
      realPerson: true,
      label: params.label?.trim() || mediaId,
      fetchImpl: params.fetchImpl ?? fetch,
    });
    return sd2CertOkSafety();
  } catch (error) {
    const code = errorCode(error);
    const message =
      error instanceof Error ? error.message : "人物校验失败";

    if (
      code === "SD2_REAL_PERSON_CERT_FAILED" ||
      code === "SD2_REAL_PERSON_CERT_BLOCKED" ||
      isSd2RealPersonCertError(code) ||
      isSd2RealPersonCertError(message)
    ) {
      if (
        /超时|TIMEOUT/i.test(message) ||
        code === "SD2_REAL_PERSON_CERT_TIMEOUT"
      ) {
        return sd2CertFailedSafety("SD 真人素材认证超时，请稍后重试");
      }
      return sd2CertRejectedSafety(
        message.replace(/^真人素材/, "").trim() ||
          "平台未通过真人素材认证",
      );
    }

    if (code === "SD2_REAL_PERSON_CERT_TIMEOUT") {
      return sd2CertFailedSafety("SD 真人素材认证超时，请稍后重试");
    }

    return sd2CertFailedSafety(message.slice(0, 200));
  }
}
