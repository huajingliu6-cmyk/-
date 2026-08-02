/**
 * 库资产人物参考：走 SD 真人认证上传并写入 videoRefSafety。
 */

import { patchImageableAssetVideoRefSafety } from "@/projects/assets/asset-image-storage";
import { readAssetImageAsDataUrl } from "@/video-generation/ark-image-safety-precheck";
import { materializeSd2AssetRef } from "@/video-generation/provider/sd2-platform-client";
import { resolveSd2PlatformCredentials } from "@/video-generation/provider/sd2-platform-config";
import { isSd2RealPersonCertError } from "@/video-generation/user-facing-error";
import type { VideoRefSafety } from "@/projects/assets/types";
import {
  SD2_CERT_MODEL_TAG,
  isSd2CertifiedForVideoRef,
  sd2CertFailedSafety,
  sd2CertOkSafety,
  sd2CertRejectedSafety,
} from "@/video-generation/sd2-cert-safety";

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

export async function runAndPersistAssetSd2Certification(params: {
  projectId: string;
  assetId: string;
  label?: string;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety> {
  const creds = await resolveSd2PlatformCredentials();
  if ("error" in creds) {
    const failed = sd2CertFailedSafety(creds.error);
    await patchImageableAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety: failed,
    });
    return failed;
  }

  const image = await readAssetImageAsDataUrl(params.projectId, params.assetId);
  if (!image) {
    const failed = sd2CertFailedSafety("无法读取资产参考图");
    await patchImageableAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety: failed,
    });
    return failed;
  }

  await patchImageableAssetVideoRefSafety({
    projectId: params.projectId,
    assetId: params.assetId,
    videoRefSafety: {
      status: "pending",
      checkedAt: new Date().toISOString(),
      modelId: SD2_CERT_MODEL_TAG,
    },
  });

  try {
    await materializeSd2AssetRef({
      apiUrl: creds.apiUrl,
      apiKey: creds.apiKey,
      sourceUrl: image.dataUrl,
      realPerson: true,
      label: params.label?.trim() || params.assetId,
      fetchImpl: params.fetchImpl ?? fetch,
    });
    const ok = sd2CertOkSafety();
    await patchImageableAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety: ok,
    });
    return ok;
  } catch (error) {
    const code = errorCode(error);
    const message =
      error instanceof Error ? error.message : "SD 人物认证失败";
    let result: VideoRefSafety;
    if (
      code === "SD2_REAL_PERSON_CERT_TIMEOUT" ||
      (/超时|TIMEOUT/i.test(message) && isSd2RealPersonCertError(message))
    ) {
      result = sd2CertFailedSafety("SD 真人素材认证超时，请稍后重试");
    } else if (
      code === "SD2_REAL_PERSON_CERT_FAILED" ||
      code === "SD2_REAL_PERSON_CERT_BLOCKED" ||
      isSd2RealPersonCertError(code) ||
      isSd2RealPersonCertError(message)
    ) {
      result = sd2CertRejectedSafety(
        message.replace(/^真人素材/, "").trim() ||
          "平台未通过真人素材认证",
      );
    } else {
      result = sd2CertFailedSafety(message.slice(0, 200));
    }
    await patchImageableAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety: result,
    });
    return result;
  }
}

export { isSd2CertifiedForVideoRef };
