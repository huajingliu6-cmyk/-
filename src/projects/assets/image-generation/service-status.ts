import "server-only";

import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";

/**
 * Lightweight image-service probe for "重新检测服务".
 * Does not enqueue generation or spend credits.
 */
export async function probeImageGenerationService(): Promise<{
  online: boolean;
  message: string;
}> {
  try {
    const resolved = await resolveAiCapabilityRuntimeConfig(
      "image.character.generate",
    );
    const profile = resolved.profile;
    if (profile.provider === "mock") {
      return { online: true, message: "图像服务已恢复（模拟模式）。" };
    }
    if (profile.provider === "http") {
      const endpoint = profile.apiUrl?.trim() ?? "";
      if (!endpoint) {
        return {
          online: false,
          message: "图像服务未配置 API 地址，请稍后重试或联系管理员。",
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(endpoint, {
          method: "GET",
          signal: controller.signal,
        });
        // Any HTTP response (even 4xx/401) means the host is reachable.
        if (res.status > 0) {
          return { online: true, message: "图像服务已恢复，可手动重新生成。" };
        }
      } catch {
        return {
          online: false,
          message: "图像服务仍不可用，请稍后再试。",
        };
      } finally {
        clearTimeout(timer);
      }
    }
    return { online: false, message: "图像服务仍不可用，请稍后再试。" };
  } catch {
    return { online: false, message: "图像服务仍不可用，请稍后再试。" };
  }
}
