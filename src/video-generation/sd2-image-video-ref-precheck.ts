import { materializeSd2AssetRef } from "@/video-generation/provider/sd2-platform-client";
import { resolveSd2PlatformCredentials } from "@/video-generation/provider/sd2-platform-config";
import {
  sd2CertFailedSafety,
  sd2CertOkSafety,
  sd2CertRejectedSafety,
} from "@/video-generation/sd2-cert-safety";
import { isSd2RealPersonCertError } from "@/video-generation/user-facing-error";
import type { VideoRefSafety } from "@/projects/assets/types";

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
 * 人物参考图 SD2 真人认证（与资产设计「人物校验」同线路）。
 * 凭证：系统管理 → API 接口 → 移动 SD2 平台。
 */
export async function precheckImageDataUrlWithSd2Cert(params: {
  dataUrl: string;
  label?: string;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety> {
  const creds = await resolveSd2PlatformCredentials();
  if ("error" in creds) {
    return sd2CertFailedSafety(creds.error);
  }

  try {
    await materializeSd2AssetRef({
      apiUrl: creds.apiUrl,
      apiKey: creds.apiKey,
      sourceUrl: params.dataUrl,
      realPerson: true,
      label: params.label?.trim() || "video-ref",
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

export async function precheckImageBufferWithSd2Cert(params: {
  buffer: Buffer;
  mimeType: string;
  label?: string;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety> {
  const mimeType = params.mimeType.startsWith("image/")
    ? params.mimeType
    : "image/png";
  return precheckImageDataUrlWithSd2Cert({
    dataUrl: `data:${mimeType};base64,${params.buffer.toString("base64")}`,
    label: params.label,
    fetchImpl: params.fetchImpl,
  });
}
