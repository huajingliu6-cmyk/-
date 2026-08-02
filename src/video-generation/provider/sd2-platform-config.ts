/**
 * 解析移动 SD2 平台凭证（可与方舟 video-shot 并存）。
 * 优先级：管理 API「sd2-platform」→ 环境变量 → video-shot（仅当方言已是 sd2）。
 */

import {
  getGenerationApiConfig,
  isPlausibleApiKey,
  normalizeGenerationApiUrl,
} from "@/auth/api-config";
import { isSd2HttpVideoDialect } from "@/video-generation/provider/http-video-dialect";
import { resolveVideoProviderRuntimeConfig } from "@/video-generation/provider/config";

export type Sd2PlatformCredentials = {
  apiUrl: string;
  apiKey: string;
  source: "sd2-platform" | "env" | "video-shot";
};

export async function resolveSd2PlatformCredentials(): Promise<
  Sd2PlatformCredentials | { error: string }
> {
  const normalizeKey = (raw: string) =>
    raw.trim().replace(/^Bearer\s+/i, "").trim();

  try {
    const dedicated = await getGenerationApiConfig("sd2-platform");
    if (dedicated.enabled !== false) {
      const apiUrl = normalizeGenerationApiUrl(dedicated.apiUrl ?? "");
      const apiKey = normalizeKey(dedicated.apiKey ?? "");
      if (dedicated.secretUnavailable) {
        return {
          error:
            "「移动 SD2 平台」的 API Key 无法解密。请确认已配置 AI_CONFIG_ENCRYPTION_KEY，并重新填写保存 Key",
        };
      }
      if (apiUrl && isPlausibleApiKey(apiKey)) {
        return { apiUrl, apiKey, source: "sd2-platform" };
      }
      if (apiUrl && !apiKey) {
        return {
          error:
            "已配置「移动 SD2 平台」地址但缺少 API Key，请到管理 API 补全并保存",
        };
      }
    }
  } catch {
    /* fall through */
  }

  const envUrl = normalizeGenerationApiUrl(
    (process.env.SD2_PLATFORM_API_URL ?? "").trim(),
  );
  const envKey = normalizeKey(process.env.SD2_PLATFORM_API_KEY ?? "");
  if (envUrl && isPlausibleApiKey(envKey)) {
    return { apiUrl: envUrl, apiKey: envKey, source: "env" };
  }
  if (envUrl && !envKey) {
    return {
      error: "已设置 SD2_PLATFORM_API_URL 但缺少 SD2_PLATFORM_API_KEY",
    };
  }

  try {
    const runtime = await resolveVideoProviderRuntimeConfig(undefined, {
      preferAdminConfig: true,
    });
    const apiUrl = (runtime.httpApiUrl ?? "").trim();
    const apiKey = normalizeKey(runtime.httpApiKey ?? "");
    if (
      runtime.providerId === "http" &&
      apiUrl &&
      isPlausibleApiKey(apiKey) &&
      isSd2HttpVideoDialect(apiUrl)
    ) {
      return { apiUrl, apiKey, source: "video-shot" };
    }
  } catch {
    /* fall through */
  }

  return {
    error:
      "人物校验需要移动 SD2 平台。请到「管理 API → 移动 SD2 平台」填写平台 URL 与 Key（视频镜头可继续用方舟）",
  };
}
