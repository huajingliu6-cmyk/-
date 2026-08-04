import { createHash } from "crypto";
import {
  SCRIPT_TXT_MAX_BYTES,
  type ScriptTxtEncoding,
} from "@/projects/script/script-txt-constants";
import { decodeScriptTxtBytes } from "@/projects/script/script-txt-decoder";
import {
  assertParseAcceptable,
  parseScriptTxtEpisodes,
  toScriptEpisodes,
  type ParsedScriptEpisodeDraft,
} from "@/projects/script/script-txt-parser";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  scriptUploadCharacterLimitMessage,
  SCRIPT_UPLOAD_MAX_CHARS,
} from "@/projects/script/script-upload-limits";

export type ScriptTxtImportPreview = {
  format: "txt";
  fileName: string;
  byteLength: number;
  sha256: string;
  encoding: ScriptTxtEncoding;
  mimeType: string | null;
  sourceText: string;
  preamble: string;
  episodes: ScriptEpisode[];
  episodeDrafts: ParsedScriptEpisodeDraft[];
  warnings: string[];
  episodeCount: number;
  characterCount: number;
};

export type ScriptTxtImportError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type ScriptTxtImportOk = {
  ok: true;
  preview: ScriptTxtImportPreview;
};

function basenameOnly(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "script.txt";
}

export function isTxtFileName(fileName: string): boolean {
  return basenameOnly(fileName).toLowerCase().endsWith(".txt");
}

/**
 * Validate + decode + parse TXT for preview. Does not touch disk drafts.
 */
export function buildScriptTxtImportPreview(input: {
  projectId: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType?: string | null;
}): ScriptTxtImportOk | ScriptTxtImportError {
  const fileName = basenameOnly(input.fileName);
  if (!isTxtFileName(fileName)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_EXTENSION",
      message: "仅支持 .txt 文件",
    };
  }

  if (input.bytes.byteLength > SCRIPT_TXT_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      message: `文件超过 ${SCRIPT_TXT_MAX_BYTES} 字节上限`,
    };
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

  const defaultTitle = fileName.replace(/\.txt$/i, "").trim() || "第1集";
  const parsed = parseScriptTxtEpisodes(decoded.text, { defaultTitle });
  if (parsed.characterCount > SCRIPT_UPLOAD_MAX_CHARS) {
    return {
      ok: false,
      status: 413,
      code: "CHARACTER_LIMIT_EXCEEDED",
      message: scriptUploadCharacterLimitMessage(parsed.characterCount),
    };
  }

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

  return {
    ok: true,
    preview: {
      format: "txt",
      fileName,
      byteLength: input.bytes.byteLength,
      sha256,
      encoding: decoded.encoding,
      mimeType: input.mimeType ?? null,
      sourceText: decoded.text,
      preamble: parsed.preamble,
      episodes,
      episodeDrafts: parsed.episodes,
      warnings: parsed.warnings,
      episodeCount: parsed.episodeCount,
      characterCount: parsed.characterCount,
    },
  };
}

/** Public API payload — never includes absolute paths. */
export function toScriptTxtImportResponse(preview: ScriptTxtImportPreview) {
  return {
    format: "txt" as const,
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
