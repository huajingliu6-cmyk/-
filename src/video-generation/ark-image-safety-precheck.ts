/**
 * 方舟多模态「Seedance 参考图」廉价预检。
 * 非视频创建同规则；用于尽早标出疑似真人图，避免白烧视频费用。
 */

import { promises as fs } from "fs";
import { getGenerationApiConfig, looksLikeArkVideoEndpoint } from "@/auth/api-config";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  findImageableAssetInDraft,
  patchImageableAssetVideoRefSafety,
  readProjectAssetImageMeta,
  resolveAssetImageFilePath,
} from "@/projects/assets/asset-image-storage";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import { getRemoteAssetImage } from "@/projects/assets/remote-asset-blob-store";
import type {
  VideoRefSafety,
  VideoRefSafetyStatus,
} from "@/projects/assets/types";
import { normalizeHttpVideoBaseUrl } from "@/video-generation/provider/http-video-dialect";
import { resolveVideoProviderRuntimeConfig } from "@/video-generation/provider/config";

/** 账号需已开通该 VLM；旧版 1.5-vision-pro 多已 Retiring/未开通会 404。 */
export const DEFAULT_ARK_VISION_PRECHECK_MODEL = "doubao-seed-2-0-lite-260215";

const PRECHECK_PROMPT = `你是 Seedance / 火山方舟视频参考图预审助手。
判断这张图作为「人物参考图」提交给 Seedance 2.0 时，是否很可能被判定为「疑似真人照片」而拒绝。

规则：
- likely_real_person：写实人脸/真人照片/电影剧照级真人皮肤质感、可识别真人面孔
- ok：明显插画、动漫、设定图、三视图、无清晰真人面孔的场景/道具
- other_risk：含明显违规或无法判断但不宜作为人物参考

只输出 JSON：{"status":"ok"|"likely_real_person"|"other_risk","reason":"不超过40字中文说明"}`;

export function parseArkVisionPrecheckResponse(
  rawText: string,
): Pick<VideoRefSafety, "status" | "reason"> {
  const trimmed = rawText.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      status: "check_failed",
      reason: "预检模型未返回可解析结果",
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      status?: string;
      reason?: string;
    };
    const status = parsed.status?.trim();
    const allowed: VideoRefSafetyStatus[] = [
      "ok",
      "likely_real_person",
      "other_risk",
    ];
    if (!status || !allowed.includes(status as VideoRefSafetyStatus)) {
      return {
        status: "check_failed",
        reason: "预检状态无效",
      };
    }
    return {
      status: status as VideoRefSafetyStatus,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim().slice(0, 80)
          : undefined,
    };
  } catch {
    return {
      status: "check_failed",
      reason: "预检 JSON 解析失败",
    };
  }
}

export type ArkVisionPrecheckRuntime = {
  mode: "http" | "mock";
  apiUrl: string;
  apiKey: string;
  modelId: string;
};

export async function resolveArkVisionPrecheckRuntime(): Promise<ArkVisionPrecheckRuntime> {
  const dedicated = await getGenerationApiConfig("video-ref-precheck");
  if (
    dedicated.provider === "http" &&
    dedicated.apiUrl.trim() &&
    dedicated.apiKey.trim() &&
    !dedicated.secretUnavailable
  ) {
    return {
      mode: "http",
      apiUrl: normalizeHttpVideoBaseUrl(dedicated.apiUrl.trim()),
      apiKey: dedicated.apiKey.trim(),
      modelId:
        dedicated.model.trim() ||
        process.env.VIDEO_REF_PRECHECK_MODEL?.trim() ||
        DEFAULT_ARK_VISION_PRECHECK_MODEL,
    };
  }

  // Prefer soft profile read over capability resolver (后者缺钥会抛，预检应降级为 check_failed)。
  try {
    const videoShot = await getGenerationApiConfig("video-shot");
    if (
      videoShot.provider === "http" &&
      videoShot.apiUrl.trim() &&
      videoShot.apiKey.trim() &&
      !videoShot.secretUnavailable
    ) {
      const base = normalizeHttpVideoBaseUrl(videoShot.apiUrl.trim());
      if (looksLikeArkVideoEndpoint(base) || base.includes("/api/v3")) {
        return {
          mode: "http",
          apiUrl: base,
          apiKey: videoShot.apiKey.trim(),
          modelId:
            process.env.VIDEO_REF_PRECHECK_MODEL?.trim() ||
            DEFAULT_ARK_VISION_PRECHECK_MODEL,
        };
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const video = await resolveVideoProviderRuntimeConfig(undefined, {
      capabilityId: "video.storyboard-shot.generate",
    });
    if (
      video.providerId === "http" &&
      video.httpApiUrl?.trim() &&
      video.httpApiKey?.trim()
    ) {
      const base = normalizeHttpVideoBaseUrl(video.httpApiUrl.trim());
      if (looksLikeArkVideoEndpoint(base) || base.includes("/api/v3")) {
        return {
          mode: "http",
          apiUrl: base,
          apiKey: video.httpApiKey.trim(),
          modelId:
            process.env.VIDEO_REF_PRECHECK_MODEL?.trim() ||
            DEFAULT_ARK_VISION_PRECHECK_MODEL,
        };
      }
    }
  } catch {
    /* fall through to mock */
  }

  return {
    mode: "mock",
    apiUrl: "",
    apiKey: "",
    modelId: "mock-vision-precheck",
  };
}

export async function readAssetImageAsDataUrl(
  projectId: string,
  assetId: string,
): Promise<{ dataUrl: string; mimeType: string } | null> {
  const draft = await loadAssetBundleDraft(projectId);
  if (!draft) return null;
  const found = findImageableAssetInDraft(draft, assetId);
  if (!found) return null;
  const storageKey = resolveAssetImageStorageKey(found.asset);
  if (isRemoteDataOnly()) {
    try {
      const remote = await getRemoteAssetImage(projectId, storageKey);
      if (!remote) return null;
      const mimeType =
        remote.contentType || found.asset.imageMimeType || "image/png";
      return {
        mimeType,
        dataUrl: `data:${mimeType};base64,${remote.body.toString("base64")}`,
      };
    } catch {
      return null;
    }
  }
  const filePath = resolveAssetImageFilePath(projectId, storageKey);
  if (!filePath) return null;
  try {
    const buf = await fs.readFile(filePath);
    const meta = await readProjectAssetImageMeta(projectId, storageKey);
    const mimeType =
      meta?.mimeType || found.asset.imageMimeType || "image/png";
    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`,
    };
  } catch {
    return null;
  }
}

export async function callArkVisionImagePrecheck(params: {
  dataUrl: string;
  runtime: ArkVisionPrecheckRuntime;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety> {
  const now = new Date().toISOString();
  if (params.runtime.mode === "mock") {
    return {
      status: "check_failed",
      checkedAt: now,
      reason: "未配置方舟图片预检（可在管理 API 配置 video-ref-precheck）",
      modelId: params.runtime.modelId,
    };
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const url = `${params.runtime.apiUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: params.runtime.modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PRECHECK_PROMPT },
              {
                type: "image_url",
                image_url: { url: params.dataUrl },
              },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    let json: {
      choices?: Array<{ message?: { content?: string | unknown } }>;
      error?: { message?: string };
    } = {};
    try {
      json = JSON.parse(rawText) as typeof json;
    } catch {
      /* keep empty */
    }
    if (!res.ok) {
      const arkMsg =
        typeof json.error?.message === "string" ? json.error.message.trim() : "";
      let reason = `预检请求失败（${res.status}）`;
      if (/not activated|未开通|activate the model/i.test(arkMsg)) {
        reason =
          "预检模型未开通：请到火山方舟控制台开通图片理解模型，并在「管理 API → 视频参考图预检」填写可用模型 ID";
      } else if (
        /does not exist|do not have access|模型不存在|无访问权限/i.test(arkMsg)
      ) {
        reason =
          "预检模型不可用：请到方舟控制台复制可用 VLM / 推理接入点 ID，填入「管理 API → 视频参考图预检 → 模型」";
      } else if (arkMsg) {
        reason = `预检请求失败（${res.status}）：${arkMsg.slice(0, 80)}`;
      }
      return {
        status: "check_failed",
        checkedAt: now,
        reason,
        modelId: params.runtime.modelId,
      };
    }
    const content = json.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? JSON.stringify(content)
          : "";
    const parsed = parseArkVisionPrecheckResponse(text);
    return {
      status: parsed.status,
      checkedAt: now,
      reason: parsed.reason,
      modelId: params.runtime.modelId,
    };
  } catch (error) {
    return {
      status: "check_failed",
      checkedAt: now,
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "预检超时"
          : "预检网络失败",
      modelId: params.runtime.modelId,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 对单个资产跑预检并写入 assets-draft */
export async function runAndPersistAssetVideoRefPrecheck(params: {
  projectId: string;
  assetId: string;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety | null> {
  const runtime = await resolveArkVisionPrecheckRuntime();
  const image = await readAssetImageAsDataUrl(params.projectId, params.assetId);
  if (!image) {
    const failed: VideoRefSafety = {
      status: "check_failed",
      checkedAt: new Date().toISOString(),
      reason: "无法读取资产参考图",
      modelId: runtime.modelId,
    };
    await patchImageableAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety: failed,
    });
    return failed;
  }

  // Mark pending first so UI can show in-progress if needed
  await patchImageableAssetVideoRefSafety({
    projectId: params.projectId,
    assetId: params.assetId,
    videoRefSafety: {
      status: "pending",
      checkedAt: new Date().toISOString(),
      modelId: runtime.modelId,
    },
  });

  const result = await callArkVisionImagePrecheck({
    dataUrl: image.dataUrl,
    runtime,
    fetchImpl: params.fetchImpl,
  });
  await patchImageableAssetVideoRefSafety({
    projectId: params.projectId,
    assetId: params.assetId,
    videoRefSafety: result,
  });
  return result;
}

/**
 * Precheck a stored project image by media/storage id (e.g. design `gen_*`),
 * without requiring a library asset row. Used by 设计素材「人物校验」.
 */
export async function runVideoRefPrecheckForImageFile(params: {
  projectId: string;
  mediaId: string;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety> {
  const runtime = await resolveArkVisionPrecheckRuntime();
  const mediaId = params.mediaId.trim();
  if (isRemoteDataOnly()) {
    try {
      const remote = await getRemoteAssetImage(params.projectId, mediaId);
      if (!remote) throw new Error("REMOTE_IMAGE_NOT_FOUND");
      return callArkVisionImagePrecheck({
        dataUrl: `data:${remote.contentType || "image/png"};base64,${remote.body.toString("base64")}`,
        runtime,
        fetchImpl: params.fetchImpl,
      });
    } catch {
      return {
        status: "check_failed",
        checkedAt: new Date().toISOString(),
        reason: "无法读取图片文件",
        modelId: runtime.modelId,
      };
    }
  }
  const filePath = resolveAssetImageFilePath(params.projectId, mediaId);
  if (!filePath) {
    return {
      status: "check_failed",
      checkedAt: new Date().toISOString(),
      reason: "无效的图片标识",
      modelId: runtime.modelId,
    };
  }
  try {
    const buf = await fs.readFile(filePath);
    const meta = await readProjectAssetImageMeta(params.projectId, mediaId);
    const mimeType = meta?.mimeType || "image/png";
    return callArkVisionImagePrecheck({
      dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`,
      runtime,
      fetchImpl: params.fetchImpl,
    });
  } catch {
    return {
      status: "check_failed",
      checkedAt: new Date().toISOString(),
      reason: "无法读取生成图文件",
      modelId: runtime.modelId,
    };
  }
}

export function needsVideoRefPrecheck(
  safety: VideoRefSafety | null | undefined,
): boolean {
  if (!safety) return true;
  if (safety.status === "pending") return true;
  return false;
}

export function isLikelyRealPersonForVideoRef(
  safety: VideoRefSafety | null | undefined,
): boolean {
  return safety?.status === "likely_real_person";
}
