import { createHash } from "crypto";
import {
  SCRIPT_DOCX_MAX_BYTES,
} from "@/projects/script/script-docx-constants";
import {
  extractScriptTextFromDocx,
  isDocxFileName,
} from "@/projects/script/script-docx-reader";
import {
  assertParseAcceptable,
  parseScriptTxtEpisodes,
  toScriptEpisodes,
} from "@/projects/script/script-txt-parser";
import type { ScriptEpisode } from "@/projects/script/types";

export type ScriptDocxImportPreview = {
  format: "docx";
  fileName: string;
  byteLength: number;
  sha256: string;
  mimeType: string | null;
  sourceText: string;
  preamble: string;
  episodes: ScriptEpisode[];
  warnings: string[];
  episodeCount: number;
  characterCount: number;
};

export type ScriptDocxImportError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type ScriptDocxImportOk = {
  ok: true;
  preview: ScriptDocxImportPreview;
};

function basenameOnly(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "script.docx";
}

export async function buildScriptDocxImportPreview(input: {
  projectId: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType?: string | null;
}): Promise<ScriptDocxImportOk | ScriptDocxImportError> {
  const fileName = basenameOnly(input.fileName);
  if (!isDocxFileName(fileName)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_EXTENSION",
      message: "仅支持 .docx 文件",
    };
  }

  if (input.bytes.byteLength > SCRIPT_DOCX_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      message: `文件超过 ${SCRIPT_DOCX_MAX_BYTES} 字节上限`,
    };
  }

  const mime = input.mimeType ?? null;
  if (
    mime &&
    mime !== "application/octet-stream" &&
    mime !==
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
    !mime.startsWith("application/zip")
  ) {
    // Soft reject only clearly unrelated types when declared.
    if (
      mime.startsWith("text/") ||
      mime.startsWith("image/") ||
      mime === "application/pdf"
    ) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_MIME",
        message: "文件类型不是 DOCX",
      };
    }
  }

  const extracted = await extractScriptTextFromDocx(input.bytes);
  if (!extracted.ok) {
    return {
      ok: false,
      status: extracted.status,
      code: extracted.code,
      message: extracted.message,
    };
  }

  const defaultTitle = fileName.replace(/\.docx$/i, "").trim() || "第1集";
  const parsed = parseScriptTxtEpisodes(extracted.text, { defaultTitle });
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
  const warnings = [...extracted.warnings, ...parsed.warnings];

  return {
    ok: true,
    preview: {
      format: "docx",
      fileName,
      byteLength: input.bytes.byteLength,
      sha256,
      mimeType: mime,
      sourceText: extracted.text,
      preamble: parsed.preamble,
      episodes,
      warnings,
      episodeCount: parsed.episodeCount,
      characterCount: parsed.characterCount,
    },
  };
}

export function toScriptDocxImportResponse(preview: ScriptDocxImportPreview) {
  return {
    format: "docx" as const,
    fileName: preview.fileName,
    byteLength: preview.byteLength,
    sha256: preview.sha256,
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
