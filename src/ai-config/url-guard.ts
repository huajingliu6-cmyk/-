/**
 * Base URL validation for admin-configured AI endpoints (SSRF guard).
 */

export type UrlGuardOptions = {
  /** When true, allow http://localhost / 127.0.0.1 / private IPs for isolated tests. */
  allowPrivateEndpoints?: boolean;
  /** Allow http:// on public hosts（如 VideoFee `http://ip:port`）。 */
  allowHttp?: boolean;
};

/** 移动 SD2 / VideoFee 槽位允许公网 http（文档示例地址非 https）。 */
export function urlGuardOptionsForProfileSlot(slotId: string): UrlGuardOptions {
  return {
    allowPrivateEndpoints: process.env.ALLOW_PRIVATE_AI_ENDPOINTS === "true",
    // video-shot 可走方舟 https，也可走移动 SD2 平台 http://ip:port（/v1/video/generations）
    allowHttp: slotId === "sd2-platform" || slotId === "video-shot",
  };
}

function parseHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = parseHost(hostname);
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (host === "metadata.google.internal") return true;
  if (host === "169.254.169.254") return true;

  const v4 = isIpv4(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  }

  // IPv6 ULA / link-local rough checks
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  return false;
}

export function assertSafeAiEndpointUrl(
  rawUrl: string,
  options: UrlGuardOptions = {},
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("API 地址不能为空");
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error("API 地址包含非法换行符");
  }
  if (/@/.test(trimmed.split("://")[1] ?? "")) {
    throw new Error("API 地址不允许嵌入用户名或密码");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("API 地址格式无效");
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("仅允许 http 或 https 协议");
  }

  const allowPrivate =
    options.allowPrivateEndpoints === true ||
    process.env.ALLOW_PRIVATE_AI_ENDPOINTS === "true";
  const allowHttp = options.allowHttp === true || allowPrivate;

  if (protocol === "http:" && !allowHttp) {
    throw new Error("生产配置仅允许 https 接口地址");
  }

  if (isPrivateOrLocalHost(url.hostname) && !allowPrivate) {
    throw new Error("不允许配置内网、本机或云元数据地址");
  }

  // Always block cloud metadata even when private endpoints allowed
  const host = parseHost(url.hostname);
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    throw new Error("不允许配置云元数据地址");
  }

  if (
    url.href.toLowerCase().includes("console.volcengine.com") ||
    url.pathname.toLowerCase().includes("/auth/login")
  ) {
    throw new Error("API 地址不能是控制台或登录页");
  }

  return url.toString().replace(/\/$/, "");
}
