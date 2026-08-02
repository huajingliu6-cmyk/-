import { SCRIPT_TXT_MAX_BYTES } from "@/projects/script/script-txt-constants";
import { SCRIPT_DOCX_MAX_BYTES } from "@/projects/script/script-docx-constants";
import { SCRIPT_MARKDOWN_MAX_BYTES } from "@/projects/script/script-markdown-constants";
import type {
  ScriptEpisode,
  ScriptImportFormat,
  ScriptSourceImport,
  ScriptTxtEncoding,
} from "@/projects/script/types";

/** Unified import preview returned by import-txt / import-docx / import-markdown. */
export type ScriptImportApiResponse = {
  format: ScriptImportFormat;
  fileName: string;
  byteLength: number;
  sha256: string;
  /** TXT / Markdown */
  encoding?: ScriptTxtEncoding;
  mimeType: string | null;
  sourceText: string;
  preamble: string;
  episodes: ScriptEpisode[];
  warnings: string[];
  episodeCount: number;
  characterCount: number;
  error?: string;
  code?: string;
};

/** @deprecated Use ScriptImportApiResponse */
export type ScriptTxtImportApiResponse = ScriptImportApiResponse;

const MAX_BYTES = Math.max(
  SCRIPT_TXT_MAX_BYTES,
  SCRIPT_DOCX_MAX_BYTES,
  SCRIPT_MARKDOWN_MAX_BYTES,
);

function extensionOf(fileName: string): string {
  const name = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  return name.toLowerCase();
}

export const SCRIPT_PDF_UNSUPPORTED_MESSAGE =
  "当前不支持 PDF 剧本，请转换为 TXT、DOCX 或 Markdown 后重新上传。";

export function validateScriptImportFileClient(file: File): string | null {
  const lower = extensionOf(file.name);
  if (lower.endsWith(".pdf")) {
    return SCRIPT_PDF_UNSUPPORTED_MESSAGE;
  }
  const okExt =
    lower.endsWith(".txt") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown");
  if (!okExt) {
    return "仅支持 .txt、.docx、.md 或 .markdown 文件";
  }
  if (file.size > MAX_BYTES) {
    return `文件超过 ${Math.floor(MAX_BYTES / (1024 * 1024))} MiB 上限`;
  }
  if (file.size === 0) {
    return "文件为空";
  }
  return null;
}

export function validateScriptTxtFileClient(file: File): string | null {
  if (!extensionOf(file.name).endsWith(".txt")) {
    return "仅支持 .txt 文件";
  }
  return validateScriptImportFileClient(file);
}

export async function postScriptTxtImport(
  projectId: string,
  file: File,
): Promise<ScriptImportApiResponse> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/script-draft/import-txt`,
    { method: "POST", body: form },
  );
  const payload = (await res.json()) as ScriptImportApiResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? `导入失败（${res.status}）`);
  }
  return { ...payload, format: payload.format ?? "txt" };
}

export async function postScriptDocxImport(
  projectId: string,
  file: File,
): Promise<ScriptImportApiResponse> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/script-draft/import-docx`,
    { method: "POST", body: form },
  );
  const payload = (await res.json()) as ScriptImportApiResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? `导入失败（${res.status}）`);
  }
  return { ...payload, format: "docx" };
}

export async function postScriptMarkdownImport(
  projectId: string,
  file: File,
): Promise<ScriptImportApiResponse> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/script-draft/import-markdown`,
    { method: "POST", body: form },
  );
  const payload = (await res.json()) as ScriptImportApiResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? `导入失败（${res.status}）`);
  }
  return { ...payload, format: "md" };
}

export async function postScriptImportByFile(
  projectId: string,
  file: File,
): Promise<ScriptImportApiResponse> {
  const name = extensionOf(file.name);
  if (name.endsWith(".docx")) {
    return postScriptDocxImport(projectId, file);
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return postScriptMarkdownImport(projectId, file);
  }
  return postScriptTxtImport(projectId, file);
}

export function buildSourceImportFromPreview(
  preview: ScriptImportApiResponse,
  importedAt = new Date().toISOString(),
): ScriptSourceImport {
  const format = preview.format ?? "txt";
  if (format === "docx") {
    return {
      format: "docx",
      fileName: preview.fileName,
      mimeType: preview.mimeType,
      byteLength: preview.byteLength,
      sha256: preview.sha256,
      importedAt,
    };
  }
  if (!preview.encoding) {
    throw new Error(
      format === "md" ? "Markdown 预览缺少 encoding" : "TXT 预览缺少 encoding",
    );
  }
  if (format === "md") {
    return {
      format: "md",
      fileName: preview.fileName,
      mimeType: preview.mimeType,
      byteLength: preview.byteLength,
      sha256: preview.sha256,
      encoding: preview.encoding,
      importedAt,
    };
  }
  return {
    format: "txt",
    fileName: preview.fileName,
    mimeType: preview.mimeType,
    byteLength: preview.byteLength,
    sha256: preview.sha256,
    encoding: preview.encoding,
    importedAt,
  };
}

export function scriptSourceFileTypeFromFormat(
  format: ScriptImportFormat,
): "txt" | "docx" | "md" {
  if (format === "docx") return "docx";
  if (format === "md") return "md";
  return "txt";
}
