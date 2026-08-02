import { createHash } from "crypto";
import { SCRIPT_MARKDOWN_MAX_BYTES } from "@/projects/script/script-markdown-constants";
import { normalizeMarkdownForScript } from "@/projects/script/script-markdown-normalizer";
import { decodeScriptTxtBytes } from "@/projects/script/script-txt-decoder";
import type { ScriptTxtEncoding } from "@/projects/script/script-txt-constants";
import {
  assertParseAcceptable,
  parseScriptTxtEpisodes,
  toScriptEpisodes,
} from "@/projects/script/script-txt-parser";
import type { ScriptEpisode } from "@/projects/script/types";

export type ScriptMarkdownImportPreview = {
  format: "md";
  fileName: string;
  byteLength: number;
  sha256: string;
  encoding: ScriptTxtEncoding;
  mimeType: string | null;
  sourceText: string;
  preamble: string;
  episodes: ScriptEpisode[];
  warnings: string[];
  episodeCount: number;
  characterCount: number;
};

export type ScriptMarkdownImportError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type ScriptMarkdownImportOk = {
  ok: true;
  preview: ScriptMarkdownImportPreview;
};

function basenameOnly(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "script.md";
}

export function isMarkdownFileName(fileName: string): boolean {
  const base = basenameOnly(fileName);
  const lower = base.toLowerCase();
  if (lower.endsWith(".markdown")) {
    return /^[^\\/]+\.markdown$/i.test(lower) && !/\.markdown\./i.test(lower);
  }
  if (lower.endsWith(".md")) {
    return /^[^\\/]+\.md$/i.test(lower) && !/\.md\./i.test(lower);
  }
  return false;
}

/**
 * Validate + decode + Markdown-normalize + parse for preview. Does not touch drafts.
 */
export function buildScriptMarkdownImportPreview(input: {
  projectId: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType?: string | null;
}): ScriptMarkdownImportOk | ScriptMarkdownImportError {
  const fileName = basenameOnly(input.fileName);
  if (!isMarkdownFileName(fileName)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_EXTENSION",
      message: "仅支持 .md 或 .markdown 文件",
    };
  }

  if (input.bytes.byteLength > SCRIPT_MARKDOWN_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      message: `文件超过 ${SCRIPT_MARKDOWN_MAX_BYTES} 字节上限`,
    };
  }

  const mime = input.mimeType ?? null;
  if (
    mime &&
    mime !== "application/octet-stream" &&
    mime !== "text/markdown" &&
    mime !== "text/plain" &&
    mime !== "text/x-markdown"
  ) {
    if (
      mime.startsWith("image/") ||
      mime === "application/pdf" ||
      mime.startsWith("application/vnd.openxmlformats")
    ) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_MIME",
        message: "文件类型不是 Markdown",
      };
    }
  }

  const decoded = decodeScriptTxtBytes(input.bytes);
  if (!decoded.ok) {
    const status = decoded.code === "TOO_LARGE" ? 413 : 400;
    return {
      ok: false,
      status,
      code: decoded.code,
      message: decoded.message,
    };
  }

  const normalized = normalizeMarkdownForScript(decoded.text);
  if (!normalized.text.trim()) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY_TEXT",
      message: "未能从 Markdown 提取到可见正文",
    };
  }

  const defaultTitle =
    fileName.replace(/\.(md|markdown)$/i, "").trim() || "第1集";
  const parsed = parseScriptTxtEpisodes(normalized.text, {
    defaultTitle,
    nonTitleLineIndexes: normalized.nonTitleLineIndexes,
  });
  const acceptable = assertParseAcceptable(parsed);
  if (!acceptable.ok) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY_PARSE",
      message: acceptable.message,
    };
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const episodes = toScriptEpisodes(input.projectId, parsed.episodes);
  const warnings = [...normalized.warnings, ...parsed.warnings];

  return {
    ok: true,
    preview: {
      format: "md",
      fileName,
      byteLength: input.bytes.byteLength,
      sha256,
      encoding: decoded.encoding,
      mimeType: mime,
      sourceText: normalized.text,
      preamble: parsed.preamble,
      episodes,
      warnings,
      episodeCount: parsed.episodeCount,
      characterCount: parsed.characterCount,
    },
  };
}

export function toScriptMarkdownImportResponse(
  preview: ScriptMarkdownImportPreview,
) {
  return {
    format: "md" as const,
    fileName: preview.fileName,
    byteLength: preview.byteLength,
    sha256: preview.sha256,
    encoding: preview.encoding,
    mimeType: preview.mimeType,
    sourceText: preview.sourceText,
    preamble: preview.preamble,
    episodes: preview.episodes.map((ep) => ({
      id: ep.id,
      projectId: ep.projectId,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      content: ep.content,
      wordCount: ep.wordCount,
      status: ep.status,
      createdAt: ep.createdAt,
      updatedAt: ep.updatedAt,
    })),
    warnings: preview.warnings,
    episodeCount: preview.episodeCount,
    characterCount: preview.characterCount,
  };
}
