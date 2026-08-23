/**
 * 库资产人物参考：走 SD 真人认证上传并写入 videoRefSafety。
 */

import {
  findImageableAssetInDraft,
  readProjectAssetImageFile,
} from "@/projects/assets/asset-image-storage";
import { isVideoRefPersistProtocolError, persistAssetVideoRefSafety } from "@/projects/assets/video-ref-precheck-persist";
import {
  loadAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import { resolveCharacterPrimaryMediaId } from "@/projects/assets/character-media-state";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import type { CharacterAsset } from "@/projects/assets/types";
import { readAssetImageAsDataUrl } from "@/video-generation/ark-image-safety-precheck";
import { materializeSd2AssetRef } from "@/video-generation/provider/sd2-platform-client";
import { resolveSd2PlatformCredentials } from "@/video-generation/provider/sd2-platform-config";
import { isSd2RealPersonCertError } from "@/video-generation/user-facing-error";
import type { VideoRefSafety } from "@/projects/assets/types";
import {
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

async function resolveCertificationMediaId(params: {
  projectId: string;
  assetId: string;
  mediaId?: string;
  store?: AssetBundleStoreScope;
}): Promise<string> {
  const explicit = params.mediaId?.trim();
  if (explicit) return explicit;

  const draft = await loadAssetBundleForScope(
    params.projectId,
    params.store ?? "management",
  );
  const found = draft
    ? findImageableAssetInDraft(draft, params.assetId)
    : null;
  if (found?.kind === "character") {
    const character = found.asset as CharacterAsset;
    const primary = resolveCharacterPrimaryMediaId(character);
    if (primary) return primary;
    return resolveAssetImageStorageKey(character);
  }
  if (found) {
    return resolveAssetImageStorageKey(found.asset);
  }
  return params.assetId;
}

async function readCertificationImageDataUrl(params: {
  projectId: string;
  assetId: string;
  mediaId: string;
}): Promise<{ dataUrl: string; mimeType: string } | null> {
  const file = await readProjectAssetImageFile(params.projectId, params.mediaId);
  if (file) {
    return {
      mimeType: file.mimeType,
      dataUrl: `data:${file.mimeType};base64,${file.buffer.toString("base64")}`,
    };
  }
  // Legacy: image bytes may still be keyed by asset id while mediaId differs.
  if (params.mediaId !== params.assetId) {
    const byAsset = await readProjectAssetImageFile(
      params.projectId,
      params.assetId,
    );
    if (byAsset) {
      return {
        mimeType: byAsset.mimeType,
        dataUrl: `data:${byAsset.mimeType};base64,${byAsset.buffer.toString("base64")}`,
      };
    }
  }
  return readAssetImageAsDataUrl(params.projectId, params.assetId);
}

export async function runAndPersistAssetSd2Certification(params: {
  projectId: string;
  assetId: string;
  /** Target media key for characters; defaults to primary / storage key. */
  mediaId?: string;
  label?: string;
  fetchImpl?: typeof fetch;
  store?: AssetBundleStoreScope;
}): Promise<VideoRefSafety> {
  const mediaId = await resolveCertificationMediaId(params);
  const store = params.store ?? "management";
  const patch = async (videoRefSafety: VideoRefSafety) => {
    await persistAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety,
      mediaId,
      store,
    });
  };

  const creds = await resolveSd2PlatformCredentials();
  if ("error" in creds) {
    const failed = sd2CertFailedSafety(creds.error);
    await patch(failed);
    return failed;
  }

  const image = await readCertificationImageDataUrl({
    projectId: params.projectId,
    assetId: params.assetId,
    mediaId,
  });
  if (!image) {
    const failed = sd2CertFailedSafety("无法读取资产参考图");
    await patch(failed);
    return failed;
  }

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
    await patch(ok);
    return ok;
  } catch (error) {
    if (isVideoRefPersistProtocolError(error)) throw error;
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
    await patch(result);
    return result;
  }
}

export { isSd2CertifiedForVideoRef };
