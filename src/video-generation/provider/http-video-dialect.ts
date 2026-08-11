/** HTTP 视频接口方言检测与 URL / 分辨率规范化 */

export type HttpVideoDialect = "ark" | "sd2" | "openai-videos" | "legacy-sync";

/** 仅配置方舟 Base URL 时的默认文生视频模型（可在管理 API 覆盖为 ep-xxx） */
export const DEFAULT_ARK_VIDEO_MODEL = "doubao-seedance-2-0-260128";

/** 移动 SD2 平台文档默认模型名（带点号） */
export const DEFAULT_SD2_VIDEO_MODEL = "doubao-seedance-2.0";

/** 控制台展示名 / 常见笔误 → 可调用的模型 ID */
const ARK_VIDEO_MODEL_ALIASES: Record<string, string> = {
  "doubao-seedance-2.0": DEFAULT_ARK_VIDEO_MODEL,
  "doubao-seedance-2": DEFAULT_ARK_VIDEO_MODEL,
  "doubao seedance 2.0": DEFAULT_ARK_VIDEO_MODEL,
  "gh seedance2.0": DEFAULT_ARK_VIDEO_MODEL,
  "gh seedance 2.0": DEFAULT_ARK_VIDEO_MODEL,
  "seedance2.0": DEFAULT_ARK_VIDEO_MODEL,
  "seedance-2.0": DEFAULT_ARK_VIDEO_MODEL,
  "seedance 2.0": DEFAULT_ARK_VIDEO_MODEL,
  "seedance-2.0-mini": "doubao-seedance-2.0-mini",
  "seedance 2.0 mini": "doubao-seedance-2.0-mini",
  "doubao-seedance-2.0-mini": "doubao-seedance-2.0-mini",
  "seedance-2.0-fast": "doubao-seedance-2.0-fast",
  "seedance 2.0 fast": "doubao-seedance-2.0-fast",
  "seedace 2.0fast": "doubao-seedance-2.0-fast",
  "doubao-seedance-2.0-fast": "doubao-seedance-2.0-fast",
};

/**
 * 归一化方舟视频模型：保留 ep-xxxx / 正式 model id；
 * 把「Doubao-Seedance-2.0」等展示名映射到默认可调用 ID。
 */
export function normalizeArkVideoModelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^ep-/i.test(trimmed)) return trimmed;
  if (/^doubao-seedance-\d+-\d+-/i.test(trimmed)) return trimmed;
  const key = trimmed.toLowerCase().replace(/[_]+/g, "-").replace(/\s+/g, " ").trim();
  return (
    ARK_VIDEO_MODEL_ALIASES[key] ??
    ARK_VIDEO_MODEL_ALIASES[key.replace(/\s/g, "-")] ??
    trimmed
  );
}

/** SD2 平台保留文档模型名；ep- 接入点原样透传 */
export function normalizeSd2VideoModelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_SD2_VIDEO_MODEL;
  if (/^ep-/i.test(trimmed)) return trimmed;
  const key = trimmed.toLowerCase().replace(/[_]+/g, "-").replace(/\s+/g, " ").trim();
  if (
    key === "doubao-seedance-2.0" ||
    key === "doubao-seedance-2" ||
    key === "seedance2.0" ||
    key === "seedance-2.0" ||
    key === "seedance 2.0" ||
    /^doubao-seedance-\d+-\d+-/i.test(trimmed)
  ) {
    return DEFAULT_SD2_VIDEO_MODEL;
  }
  if (
    key === "seedance-2.0-mini" ||
    key === "seedance 2.0 mini" ||
    key === "doubao-seedance-2.0-mini"
  ) {
    return "doubao-seedance-2.0-mini";
  }
  if (
    key === "seedance-2.0-fast" ||
    key === "seedance 2.0 fast" ||
    key === "seedace 2.0fast" ||
    key === "doubao-seedance-2.0-fast"
  ) {
    return "doubao-seedance-2.0-fast";
  }
  return trimmed;
}

/** Seedance 2.0：官方时长 4–15 秒（含 r2v） */
export const SEEDANCE_MIN_DURATION_SECONDS = 4;
export const SEEDANCE_MAX_DURATION_SECONDS = 15;

export function isSeedanceVideoModel(modelId: string): boolean {
  return /seedance/i.test(modelId.trim());
}

/** 将时长钳制到方舟/Seedance 可接受范围 */
export function clampArkVideoDurationSeconds(
  durationSeconds: number,
  modelId: string,
): number {
  const raw = Math.round(durationSeconds);
  const fallback = 5;
  const n = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  if (!isSeedanceVideoModel(modelId)) {
    return Math.max(1, Math.min(15, n));
  }
  return Math.max(
    SEEDANCE_MIN_DURATION_SECONDS,
    Math.min(SEEDANCE_MAX_DURATION_SECONDS, n),
  );
}

/** 知行 / 方舟标准 Base URL */
export const DEFAULT_ARK_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/v3";

/** 修正常见笔误，并去掉尾斜杠 */
export function normalizeHttpVideoBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/cn-bejing\./gi, "cn-beijing.")
    .replace(/\/+$/, "");
}

/**
 * 解析 HTTP 视频方言。
 * - 可用环境变量 VIDEO_SHOT_HTTP_DIALECT=sd2|ark|openai-videos|legacy-sync 强制指定
 * - 移动 SD2：`/v1/video/generations`、真人素材路径，或平台根地址（文档 Base URL）
 * - 方舟：ark…/api/v3 或 /contents/generations/tasks
 * - openai-videos：/v1/videos（勿与 SD2 的 /v1/video/generations 混淆）
 */
export function detectHttpVideoDialect(apiUrl: string): HttpVideoDialect {
  const forced = process.env.VIDEO_SHOT_HTTP_DIALECT?.trim().toLowerCase();
  if (
    forced === "sd2" ||
    forced === "mobile-sd2" ||
    forced === "seedance-mobile"
  ) {
    return "sd2";
  }
  if (forced === "ark") return "ark";
  if (forced === "openai-videos" || forced === "openai") return "openai-videos";
  if (forced === "legacy" || forced === "legacy-sync") return "legacy-sync";

  const u = normalizeHttpVideoBaseUrl(apiUrl).toLowerCase();
  if (u.includes("console.volcengine.com") || u.includes("/auth/login")) {
    return "legacy-sync";
  }
  if (
    u.includes("ark.cn-beijing.volces.com") ||
    u.includes("ark.cn-bejing.volces.com") ||
    u.includes("/contents/generations/tasks") ||
    (/volces\.com/.test(u) && /\/api\/v3/.test(u))
  ) {
    return "ark";
  }
  if (
    u.includes("/v1/video/generations") ||
    u.includes("/api/real-person-assets") ||
    u.includes("/api/assets/") ||
    u.includes("mobile-sd2") ||
    u.includes("sd2-platform")
  ) {
    return "sd2";
  }
  if (u.includes("/v1/videos")) {
    return "openai-videos";
  }
  // 文档平台根：http(s)://host[:port]（无路径）→ 创建时拼 /v1/video/generations
  if (/^https?:\/\/[^/]+$/i.test(u)) {
    return "sd2";
  }
  return "legacy-sync";
}

export function isSd2HttpVideoDialect(apiUrl: string): boolean {
  return detectHttpVideoDialect(apiUrl) === "sd2";
}

/** 画布 480P/720P/1080P → 方舟 / SD2 resolution（小写 p） */
export function toArkResolution(resolution: string): string {
  const upper = resolution.trim().toUpperCase();
  if (upper === "480P" || upper === "480") return "480p";
  if (upper === "1080P" || upper === "1080") return "1080p";
  return "720p";
}

export function buildArkCreateUrl(apiUrl: string): string {
  const base = normalizeHttpVideoBaseUrl(apiUrl);
  if (/\/contents\/generations\/tasks$/i.test(base)) {
    return base;
  }
  if (/\/api\/v3$/i.test(base)) {
    return `${base}/contents/generations/tasks`;
  }
  return `${base}/api/v3/contents/generations/tasks`;
}

export function buildArkStatusUrl(apiUrl: string, taskId: string): string {
  return `${buildArkCreateUrl(apiUrl)}/${encodeURIComponent(taskId)}`;
}

/** SD2 平台根（去掉创建路径后缀） */
export function buildSd2PlatformRoot(apiUrl: string): string {
  return normalizeHttpVideoBaseUrl(apiUrl).replace(
    /\/v1\/video\/generations$/i,
    "",
  );
}

export function buildSd2CreateUrl(apiUrl: string): string {
  const base = normalizeHttpVideoBaseUrl(apiUrl);
  if (/\/v1\/video\/generations$/i.test(base)) return base;
  return `${buildSd2PlatformRoot(base)}/v1/video/generations`;
}

export function buildSd2StatusUrl(apiUrl: string, taskId: string): string {
  return `${buildSd2CreateUrl(apiUrl)}/${encodeURIComponent(taskId)}`;
}

export function buildSd2ContentUrl(apiUrl: string, taskId: string): string {
  return `${buildSd2PlatformRoot(apiUrl)}/v1/videos/${encodeURIComponent(taskId)}/content`;
}

export function buildSd2NormalAssetUploadUrl(apiUrl: string): string {
  return `${buildSd2PlatformRoot(apiUrl)}/api/assets/upload`;
}

export function buildSd2RealPersonAssetUploadUrl(apiUrl: string): string {
  return `${buildSd2PlatformRoot(apiUrl)}/api/real-person-assets/upload`;
}

export function buildSd2AssetDetailUrl(apiUrl: string, assetKey: string): string {
  return `${buildSd2PlatformRoot(apiUrl)}/api/assets/${encodeURIComponent(assetKey)}`;
}

/** 方舟 size 如 854x480 → 用于 Provider 侧展示 */
export function mapArkSizeToProviderResolution(
  size: string | undefined,
): string | undefined {
  if (!size) return undefined;
  const m = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  const shortSide = Math.min(w, h);
  if (shortSide <= 540) return "480";
  if (shortSide <= 900) return "720";
  return "1080";
}
