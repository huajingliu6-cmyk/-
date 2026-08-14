/**
 * 移动 SD2 平台素材上传与真人认证（客户侧只见 asset://，不见上游认证 ID）。
 * 规则见桌面《Seedance2.0API接口文档.md》。
 */

import {
  buildSd2AssetDetailUrl,
  buildSd2NormalAssetUploadUrl,
  buildSd2RealPersonAssetUploadUrl,
} from "@/video-generation/provider/http-video-dialect";
import type { FetchLike } from "@/video-generation/provider/types";

export type Sd2AssetUploadResult = {
  assetKey: string;
  assetRef: string;
  requiresCertification: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickAssetRef(row: Record<string, unknown> | undefined): {
  assetKey: string;
  assetRef: string;
  requiresCertification: boolean;
} {
  const assetKey =
    (typeof row?.assetKey === "string" && row.assetKey.trim()) ||
    (typeof row?.asset_key === "string" && row.asset_key.trim()) ||
    "";
  const assetRef =
    (typeof row?.assetRef === "string" && row.assetRef.trim()) ||
    (typeof row?.asset_ref === "string" && row.asset_ref.trim()) ||
    (assetKey ? `asset://${assetKey}` : "");
  const requiresCertification =
    row?.requiresCertification === true ||
    row?.purpose === "real_person" ||
    false;
  if (!assetRef) {
    throw Object.assign(new Error("SD2 素材上传未返回 assetRef"), {
      code: "SD2_ASSET_UPLOAD_INVALID",
    });
  }
  return {
    assetKey: assetKey || assetRef.replace(/^asset:\/\//, ""),
    assetRef,
    requiresCertification,
  };
}

function mimeToExt(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  return ".png";
}

export function parseDataUrl(dataUrl: string): {
  mime: string;
  buffer: Buffer;
} | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!m) return null;
  try {
    return {
      mime: m[1]!.trim() || "application/octet-stream",
      buffer: Buffer.from(m[2]!, "base64"),
    };
  } catch {
    return null;
  }
}

function formatSd2UpstreamError(
  json: unknown,
  rawText: string,
  status: number,
): string {
  const fallback = rawText.trim().slice(0, 200) || `HTTP ${status}`;
  if (!json || typeof json !== "object") return fallback;
  const root = json as Record<string, unknown>;
  const pick = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.message === "string" && o.message.trim()) {
        return o.message.trim();
      }
      if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
      if (typeof o.msg === "string" && o.msg.trim()) return o.msg.trim();
      try {
        return JSON.stringify(v).slice(0, 200);
      } catch {
        return null;
      }
    }
    return null;
  };
  return (
    pick(root.error) ||
    pick(root.message) ||
    pick(root.msg) ||
    (() => {
      try {
        return JSON.stringify(root).slice(0, 200);
      } catch {
        return fallback;
      }
    })()
  );
}

function normalizeSd2ApiKey(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "").trim();
}

async function uploadMultipart(params: {
  uploadUrl: string;
  apiKey: string;
  buffer: Buffer;
  mime: string;
  fileName: string;
  fetchImpl: FetchLike;
}): Promise<Sd2AssetUploadResult> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.buffer)], {
    type: params.mime,
  });
  form.append("file", blob, params.fileName);

  const apiKey = normalizeSd2ApiKey(params.apiKey);
  if (!apiKey) {
    throw Object.assign(new Error("SD2 API Key 为空，请到「系统管理 → API 接口 → 移动 SD2 平台」重新填写"), {
      code: "SD2_API_KEY_MISSING",
    });
  }

  const res = await params.fetchImpl(params.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const rawText = await res.text();
  let json: unknown = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw Object.assign(
      new Error(`SD2 素材上传响应无效（${res.status}）：${rawText.slice(0, 160)}`),
      { code: "SD2_ASSET_UPLOAD_INVALID" },
    );
  }
  if (!res.ok) {
    const detail = formatSd2UpstreamError(json, rawText, res.status);
    const authHint =
      res.status === 401 || res.status === 403
        ? "。请确认 Key 是移动 SD2/VideoFee 平台密钥（不是方舟 Ark Key），保存后重试"
        : "";
    throw Object.assign(
      new Error(`SD2 素材上传失败（${res.status}）：${detail}${authHint}`),
      { code: "SD2_ASSET_UPLOAD_FAILED" },
    );
  }
  const row =
    json && typeof json === "object" && "row" in json
      ? (json as { row?: Record<string, unknown> }).row
      : undefined;
  return pickAssetRef(row);
}

/**
 * 将本地 data URL 或公网 https URL 转为 SD2 asset:// 引用。
 * realPerson=true 时走 /api/real-person-assets/upload 并等待认证 active。
 */
export async function materializeSd2AssetRef(params: {
  apiUrl: string;
  apiKey: string;
  sourceUrl: string;
  realPerson: boolean;
  label: string;
  fetchImpl: FetchLike;
}): Promise<string> {
  const { apiUrl, apiKey, sourceUrl, realPerson, fetchImpl } = params;

  if (sourceUrl.startsWith("asset://")) {
    if (realPerson) {
      const key = sourceUrl.replace(/^asset:\/\//, "");
      await waitSd2RealPersonCertification({
        apiUrl,
        apiKey,
        assetKey: key,
        label: params.label,
        fetchImpl,
      });
    }
    return sourceUrl;
  }

  let buffer: Buffer;
  let mime: string;
  const parsed = parseDataUrl(sourceUrl);
  if (parsed) {
    buffer = parsed.buffer;
    mime = parsed.mime;
  } else if (/^https:\/\//i.test(sourceUrl) && !/localhost|127\.0\.0\.1/i.test(sourceUrl)) {
    const res = await fetchImpl(sourceUrl);
    if (!res.ok) {
      throw Object.assign(
        new Error(`无法下载参考素材（${res.status}）：${params.label}`),
        { code: "SD2_ASSET_FETCH_FAILED" },
      );
    }
    buffer = Buffer.from(await res.arrayBuffer());
    mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  } else {
    throw Object.assign(
      new Error(`SD2 不支持的参考地址（需 data URL 或公网 HTTPS）：${params.label}`),
      { code: "SD2_ASSET_URL_UNSUPPORTED" },
    );
  }

  const uploadUrl = realPerson
    ? buildSd2RealPersonAssetUploadUrl(apiUrl)
    : buildSd2NormalAssetUploadUrl(apiUrl);
  const uploaded = await uploadMultipart({
    uploadUrl,
    apiKey,
    buffer,
    mime,
    fileName: `ref${mimeToExt(mime)}`,
    fetchImpl,
  });

  if (realPerson || uploaded.requiresCertification) {
    await waitSd2RealPersonCertification({
      apiUrl,
      apiKey,
      assetKey: uploaded.assetKey,
      label: params.label,
      fetchImpl,
    });
  }
  return uploaded.assetRef;
}

export async function waitSd2RealPersonCertification(params: {
  apiUrl: string;
  apiKey: string;
  assetKey: string;
  fetchImpl: FetchLike;
  /** 素材展示名，写入失败文案便于分镜面板定位 */
  label?: string;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<void> {
  const maxAttempts = params.maxAttempts ?? 40;
  const intervalMs = params.intervalMs ?? 3000;
  const labelSuffix = params.label?.trim() ? `（${params.label.trim()}）` : "";
  let lastMessage = "认证进行中";

  for (let i = 0; i < maxAttempts; i++) {
    const detailUrl = buildSd2AssetDetailUrl(params.apiUrl, params.assetKey);
    const res = await params.fetchImpl(detailUrl, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
    });
    const rawText = await res.text();
    let json: {
      row?: {
        status?: string;
        certifications?: Array<{ status?: string; interfaceCode?: string }>;
        assetCertification?: { status?: string; message?: string; ok?: boolean | null };
      };
    } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      lastMessage = `认证查询响应无效：${rawText.slice(0, 120)}`;
      await sleep(intervalMs);
      continue;
    }
    if (!res.ok) {
      lastMessage = `认证查询失败（${res.status}）`;
      await sleep(intervalMs);
      continue;
    }

    const statuses: string[] = [];
    // VideoFee 文档：真人素材轮询优先读 row.status
    const rowStatus = (json.row?.status ?? "").toLowerCase();
    if (rowStatus) statuses.push(rowStatus);
    const certs = json.row?.certifications ?? [];
    for (const c of certs) {
      const s = (c.status ?? "").toLowerCase();
      if (s) statuses.push(s);
    }
    const single = (json.row?.assetCertification?.status ?? "").toLowerCase();
    if (single) statuses.push(single);

    if (statuses.some((s) => s === "active")) {
      return;
    }
    if (statuses.some((s) => s === "failed")) {
      throw Object.assign(
        new Error(
          `真人素材认证失败${labelSuffix}：${json.row?.assetCertification?.message || "请重新上传或联系平台"}`,
        ),
        { code: "SD2_REAL_PERSON_CERT_FAILED" },
      );
    }
    if (statuses.some((s) => s === "blocked")) {
      throw Object.assign(
        new Error(`真人素材已被平台禁止使用（blocked）${labelSuffix}`),
        { code: "SD2_REAL_PERSON_CERT_BLOCKED" },
      );
    }
    lastMessage =
      json.row?.assetCertification?.message ||
      (statuses.includes("certifying") ? "真人认证进行中" : "等待真人认证…");
    await sleep(intervalMs);
  }

  throw Object.assign(
    new Error(`真人素材认证超时${labelSuffix}：${lastMessage}`),
    { code: "SD2_REAL_PERSON_CERT_TIMEOUT" },
  );
}

export function mapSd2TaskStatus(
  raw: string | undefined,
): "queued" | "processing" | "completed" | "failed" | "cancelled" {
  const st = (raw ?? "").toLowerCase();
  if (
    st === "succeeded" ||
    st === "success" ||
    st === "completed" ||
    st === "complete"
  ) {
    return "completed";
  }
  // VideoFee 文档：SUCCESS / FAILURE / IN_PROGRESS / QUEUED / CANCELLED
  if (st === "failed" || st === "error" || st === "failure") return "failed";
  if (st === "cancelled" || st === "canceled") return "cancelled";
  if (
    st === "processing" ||
    st === "running" ||
    st === "in_progress" ||
    st === "in-progress"
  ) {
    return "processing";
  }
  return "queued";
}
