/**
 * 视频出站调用 TXT 监听（初期）。
 * 写入 APP_DATA_DIR/logs/video-outbound/YYYY-MM-DD.txt，供对账与抽卡追溯。
 *
 * 核心原则：日志应保存「系统真实发给上游」的调用格式（method/url/headers/body），
 * 以及上游原始响应；密钥脱敏；超大 data URL 截断。
 *
 * 对账字段：
 * - clientIdempotencyKey：分镜前端幂等
 * - upstreamIdempotencyKey：上送 Provider 的幂等（SD2 现为 generationId）
 * - mediaFingerprint：同素材反复抽卡对齐键
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";

export type VideoOutboundLogEvent = {
  event:
    | "video.create.request"
    | "video.create.response"
    | "video.create.error"
    | "sd2.asset.upload"
    | "sd2.asset.cert";
  at?: string;
  dialect?: "sd2" | "ark" | "openai-videos" | "legacy-sync" | string;
  generationId?: string;
  /** 客户端 / 分镜提交幂等键 */
  clientIdempotencyKey?: string | null;
  /** 实际上送上游的 Idempotency-Key */
  upstreamIdempotencyKey?: string | null;
  projectId?: string | null;
  shotId?: string | null;
  model?: string | null;
  url?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  upstreamTaskId?: string | null;
  mediaAssetIds?: string[];
  /** 排序后的资产 id 指纹，同图反复抽卡可对齐 */
  mediaFingerprint?: string | null;
  mediaSummary?: Array<{
    assetId: string;
    label?: string;
    kind?: string;
    realPerson?: boolean;
    assetRef?: string;
  }>;
  promptChars?: number;
  promptSha256?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  /** 实际上送 headers（Authorization 已脱敏） */
  requestHeaders?: Record<string, string> | null;
  /**
   * 实际上送 body：JSON 对象或 multipart 描述。
   * 应与 fetch body 一致（data URL 过大时截断）。
   */
  requestBody?: unknown;
  /** 上游原始响应体（文本；过大截断） */
  responseBody?: string | null;
  ok?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** @deprecated 使用 responseBody；保留兼容旧调用 */
  responseSnippet?: string | null;
  note?: string | null;
};

const MAX_STRING_CHARS = 20_000;
const MAX_RESPONSE_CHARS = 8_000;
const DATA_URL_KEEP_PREFIX = 48;

export function videoOutboundLogDir(): string {
  return resolveAppDataPath("logs", "video-outbound");
}

export function videoOutboundLogFilePath(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return path.join(videoOutboundLogDir(), `${day}.txt`);
}

/** 同素材反复抽卡对齐：仅依赖资产 id 集合，与 generationId 无关 */
export function buildMediaFingerprint(assetIds: string[]): string {
  const normalized = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))]
    .sort()
    .join("|");
  if (!normalized) return "media:empty";
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
  return `media:${hash}`;
}

export function hashPromptForLog(prompt: string): string {
  return createHash("sha256").update(prompt ?? "", "utf8").digest("hex").slice(0, 16);
}

export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/("apiKey"\s*:\s*")[^"]+"/gi, '$1***"')
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "sk-***");
}

/** 脱敏实际上送 headers，供日志落盘 */
export function sanitizeOutboundHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/^authorization$/i.test(key)) {
      out[key] = "Bearer ***";
      continue;
    }
    out[key] = redactSecrets(String(value ?? ""));
  }
  return out;
}

function truncateMarked(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated chars=${text.length}]`;
}

/**
 * 清洗实际上送 body：保留真实结构；截断 data URL / 超长字符串；脱敏密钥字段。
 */
export function sanitizeOutboundBodyForLog(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[MaxDepth]";
  if (typeof value === "string") {
    if (/^data:[^,]*,/i.test(value) && value.length > DATA_URL_KEEP_PREFIX + 16) {
      return `${value.slice(0, DATA_URL_KEEP_PREFIX)}…[data-url omitted chars=${value.length}]`;
    }
    return truncateMarked(value, MAX_STRING_CHARS);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOutboundBodyForLog(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(apiKey|authorization|secret|token|password)$/i.test(key)) {
        out[key] = /^authorization$/i.test(key) ? "Bearer ***" : "***";
        continue;
      }
      out[key] = sanitizeOutboundBodyForLog(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function formatOutboundJson(value: unknown): string {
  try {
    return JSON.stringify(sanitizeOutboundBodyForLog(value), null, 2);
  } catch {
    return String(value);
  }
}

export function formatVideoOutboundJsonEvent(
  event: VideoOutboundLogEvent,
): Record<string, unknown> {
  return {
    timestamp: event.at ?? new Date().toISOString(),
    level: event.event.endsWith(".error") || event.ok === false ? "error" : "info",
    event: event.event,
    dialect: event.dialect ?? null,
    generationId: event.generationId ?? null,
    clientIdempotencyKey: event.clientIdempotencyKey ?? null,
    upstreamIdempotencyKey: event.upstreamIdempotencyKey ?? null,
    projectId: event.projectId ?? null,
    shotId: event.shotId ?? null,
    model: event.model ?? null,
    method: event.method ?? null,
    upstreamHost: safeLogHost(event.url),
    httpStatus: event.httpStatus ?? null,
    upstreamTaskId: event.upstreamTaskId ?? null,
    mediaAssetIds: event.mediaAssetIds ?? [],
    mediaFingerprint: event.mediaFingerprint ?? null,
    promptChars: event.promptChars ?? null,
    promptSha256: event.promptSha256 ?? null,
    durationSeconds: event.durationSeconds ?? null,
    resolution: event.resolution ?? null,
    ok: event.ok ?? null,
    errorCode: event.errorCode ?? null,
    errorMessage: event.errorMessage
      ? truncateMarked(redactSecrets(event.errorMessage), 500)
      : null,
    note: event.note ? truncateMarked(redactSecrets(event.note), 500) : null,
  };
}

function safeLogHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function putBlock(lines: string[], key: string, text: string) {
  const cleaned = redactSecrets(text).replace(/\r\n/g, "\n").trimEnd();
  if (!cleaned) return;
  lines.push(`${key}:`);
  for (const line of cleaned.split("\n")) {
    lines.push(`  ${line}`);
  }
}

/** 格式化为可人工阅读、后续可解析的 TXT 块 */
export function formatVideoOutboundTxtBlock(
  event: VideoOutboundLogEvent,
): string {
  const at = event.at ?? new Date().toISOString();
  const lines: string[] = [
    `===== ${at} | event=${event.event}${event.dialect ? ` | dialect=${event.dialect}` : ""} =====`,
  ];
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
      return;
    }
    lines.push(`${k}: ${typeof v === "string" ? redactSecrets(v) : String(v)}`);
  };

  put("generationId", event.generationId);
  put("clientIdempotencyKey", event.clientIdempotencyKey);
  put("upstreamIdempotencyKey", event.upstreamIdempotencyKey);
  put("projectId", event.projectId);
  put("shotId", event.shotId);
  put("model", event.model);
  put("method", event.method);
  put("url", event.url);
  put("httpStatus", event.httpStatus);
  put("upstreamTaskId", event.upstreamTaskId);
  put("mediaFingerprint", event.mediaFingerprint);
  put("mediaAssetIds", event.mediaAssetIds);
  if (event.mediaSummary?.length) {
    put("mediaSummary", event.mediaSummary);
  }
  put("promptChars", event.promptChars);
  put("promptSha256", event.promptSha256);
  put("durationSeconds", event.durationSeconds);
  put("resolution", event.resolution);
  if (event.requestHeaders && Object.keys(event.requestHeaders).length > 0) {
    putBlock(lines, "requestHeaders", formatOutboundJson(event.requestHeaders));
  }
  if (event.requestBody !== undefined) {
    putBlock(lines, "requestBody", formatOutboundJson(event.requestBody));
  }
  const responseText = event.responseBody ?? event.responseSnippet;
  if (responseText) {
    const trimmed = truncateMarked(redactSecrets(responseText), MAX_RESPONSE_CHARS);
    // 尽量 pretty-print JSON 响应
    let pretty = trimmed;
    try {
      pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      /* keep raw */
    }
    putBlock(lines, "responseBody", pretty);
  }
  put("ok", event.ok);
  put("errorCode", event.errorCode);
  put(
    "errorMessage",
    event.errorMessage ? truncateMarked(event.errorMessage, 500) : null,
  );
  put("note", event.note);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * 追加写入当天 TXT。永不抛错，避免日志拖垮出片。
 */
export async function appendVideoOutboundTxtLog(
  event: VideoOutboundLogEvent,
): Promise<string | null> {
  try {
    if (isRemoteDataOnly()) {
      console.info(JSON.stringify(formatVideoOutboundJsonEvent(event)));
      return "stdout:json";
    }
    const filePath = videoOutboundLogFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, formatVideoOutboundTxtBlock(event), "utf8");
    return filePath;
  } catch (err) {
    console.warn(
      "[video-outbound-log] append failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function summarizeResolvedMediaForLog(
  media: Array<{
    assetId: string;
    label?: string;
    kind?: string;
    realPersonCandidate?: boolean;
  }>,
): {
  mediaAssetIds: string[];
  mediaFingerprint: string;
  mediaSummary: NonNullable<VideoOutboundLogEvent["mediaSummary"]>;
} {
  const mediaAssetIds = media.map((m) => m.assetId).filter(Boolean);
  return {
    mediaAssetIds,
    mediaFingerprint: buildMediaFingerprint(mediaAssetIds),
    mediaSummary: media.map((m) => ({
      assetId: m.assetId,
      label: m.label,
      kind: m.kind,
      realPerson: m.realPersonCandidate === true,
    })),
  };
}
