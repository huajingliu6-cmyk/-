import type { CharacterAsset, VideoRefSafety } from "@/projects/assets/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

export type LibrarySd2PrecheckResult = {
  ok: boolean;
  videoRefSafety: VideoRefSafety | null;
  notice: string;
  character?: CharacterAsset;
  error?: string;
};

/**
 * Client helper: POST library assets-draft SD2 person certification.
 * Path: `${apiRoot}/assets-draft/images/${assetId}/video-ref-precheck`
 */
export async function postLibrarySd2Precheck(params: {
  apiRoot: string;
  assetId: string;
  mediaId?: string | null;
}): Promise<LibrarySd2PrecheckResult> {
  const response = await fetch(
    `${params.apiRoot}/assets-draft/images/${encodeURIComponent(params.assetId)}/video-ref-precheck`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        params.mediaId?.trim()
          ? { mediaId: params.mediaId.trim() }
          : {},
      ),
    },
  );
  let payload: {
    error?: string;
    notice?: string;
    videoRefSafety?: VideoRefSafety;
    character?: CharacterAsset;
  };
  try {
    payload = await parseResponseJson(response);
  } catch (caught) {
    return {
      ok: false,
      videoRefSafety: null,
      notice: "",
      error:
        caught instanceof Error ? caught.message : "人物校验失败",
    };
  }
  if (!payload) {
    return {
      ok: false,
      videoRefSafety: null,
      notice: "",
      error: "服务器没有返回有效数据，请稍后重试。",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      videoRefSafety: payload.videoRefSafety ?? null,
      notice: payload.notice ?? "",
      error: payload.error ?? "人物校验失败",
      character: payload.character,
    };
  }
  const safety = payload.videoRefSafety ?? null;
  return {
    ok: isSd2CertifiedForVideoRef(safety),
    videoRefSafety: safety,
    notice: payload.notice ?? (isSd2CertifiedForVideoRef(safety) ? "人物校验完成" : "人物校验未通过"),
    character: payload.character,
    error: isSd2CertifiedForVideoRef(safety)
      ? undefined
      : payload.notice || payload.error || "人物校验未通过",
  };
}
