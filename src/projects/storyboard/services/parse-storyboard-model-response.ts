/**
 * Tolerant parser for storyboard-prompt LLM responses.
 * Supports JSON envelopes, Markdown fences, embedded JSON, and section text.
 * Never uses eval / Function / unsafe JSON mutators.
 */

export type ParsedStoryboardPrompt = {
  sourceShotId?: string;
  sourceShotNumber?: number;
  videoPrompt: string;
};

export type StoryboardResponseParser =
  | "json"
  | "markdown_json"
  | "embedded_json"
  | "section_text"
  | "clips-json";

export type ParseStoryboardModelResponseResult = {
  prompts: ParsedStoryboardPrompt[];
  parser: StoryboardResponseParser | null;
  diagnostics: {
    candidateCount: number;
    invalidCount: number;
    duplicateIdCount: number;
  };
};

const ARRAY_KEYS = ["shots", "storyboard", "items", "data", "results", "prompts"] as const;

const ID_KEYS = [
  "shotId",
  "shot_id",
  "id",
  "shotNo",
  "shotNumber",
  "shotIndex",
  "index",
  "镜头ID",
  "镜头id",
  "分镜ID",
  "分镜id",
  "编号",
] as const;

const PROMPT_KEYS = [
  "videoPrompt",
  "video_prompt",
  "prompt",
  "imagePrompt",
  "image_prompt",
  "description",
  "content",
  "text",
  "body",
  "value",
  "shotPrompt",
  "fullPrompt",
  "提示词",
  "视频提示词",
  "镜头提示词",
  "分镜提示词",
  "正文",
] as const;

function stripBom(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

function stripMarkdownFence(raw: string): { text: string; wasFenced: boolean } {
  const trimmed = raw.trim();
  const full = /^```(?:json|javascript|js|text|markdown|md)?\s*([\s\S]*?)```$/i.exec(
    trimmed,
  );
  if (full) {
    return { text: full[1]!.trim(), wasFenced: true };
  }
  // Prefer first fenced block if present among prose.
  const inner = /```(?:json|javascript|js|text|markdown|md)?\s*([\s\S]*?)```/i.exec(
    trimmed,
  );
  if (inner) {
    return { text: inner[1]!.trim(), wasFenced: true };
  }
  return { text: trimmed, wasFenced: false };
}

function tryJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Extract balanced `{...}` / `[...]` candidates from prose. */
function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const openers: Array<{ ch: "{" | "["; index: number }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "{" || ch === "[") {
      openers.push({ ch, index: i });
      continue;
    }
    if (ch !== "}" && ch !== "]") continue;
    // Match from the last compatible opener.
    for (let j = openers.length - 1; j >= 0; j -= 1) {
      const opener = openers[j]!;
      const want = opener.ch === "{" ? "}" : "]";
      if (ch !== want) continue;
      const slice = text.slice(opener.index, i + 1).trim();
      if (slice.length >= 2) candidates.push(slice);
      openers.splice(j, 1);
      break;
    }
  }
  // Prefer longer candidates first (more complete JSON).
  return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectRowArrays(
  value: unknown,
  depth = 0,
  out: Record<string, unknown>[][] = [],
): Record<string, unknown>[][] {
  if (depth > 6) return out;
  if (Array.isArray(value)) {
    const rows = value.filter(
      (row): row is Record<string, unknown> => Boolean(asRecord(row)),
    );
    if (rows.length > 0) out.push(rows);
    for (const item of value) {
      collectRowArrays(item, depth + 1, out);
    }
    return out;
  }
  const obj = asRecord(value);
  if (!obj) return out;
  for (const key of ARRAY_KEYS) {
    if (key in obj) collectRowArrays(obj[key], depth + 1, out);
  }
  // Also scan other object values shallowly for nested envelopes.
  for (const [key, nested] of Object.entries(obj)) {
    if ((ARRAY_KEYS as readonly string[]).includes(key)) continue;
    if (nested && typeof nested === "object") {
      collectRowArrays(nested, depth + 1, out);
    }
  }
  return out;
}

function readShotNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const m = value.trim().match(/(\d{1,4})/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function readRowShotId(row: Record<string, unknown>): string | undefined {
  for (const key of ID_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      // Numeric-looking id fields are treated as shot numbers, not opaque ids,
      // except explicit shotId / shot_id / id strings that contain letters.
      if (
        (key === "shotNo" ||
          key === "shotNumber" ||
          key === "shotIndex" ||
          key === "index") &&
        /^\d+$/.test(value.trim())
      ) {
        continue;
      }
      return value.trim();
    }
    if (
      typeof value === "number" &&
      (key === "shotId" || key === "shot_id" || key === "id")
    ) {
      return String(Math.floor(value));
    }
  }
  return undefined;
}

function readRowShotNumber(row: Record<string, unknown>): number | undefined {
  for (const key of [
    "shotNo",
    "shotNumber",
    "shotIndex",
    "index",
    "shotId",
    "shot_id",
    "id",
  ] as const) {
    if (!(key in row)) continue;
    const n = readShotNumber(row[key]);
    if (n != null) {
      // Prefer dedicated number fields; for id-like fields only accept pure digits.
      if (key === "shotId" || key === "shot_id" || key === "id") {
        const raw = row[key];
        if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) continue;
      }
      return n;
    }
  }
  return undefined;
}

function coercePromptValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return sanitizePromptText(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        const rec = asRecord(item);
        if (!rec) return "";
        for (const key of PROMPT_KEYS) {
          const nested = rec[key];
          if (typeof nested === "string" && nested.trim()) return nested.trim();
        }
        return "";
      })
      .filter(Boolean);
    if (parts.length > 0) return sanitizePromptText(parts.join("\n"));
  }
  const rec = asRecord(value);
  if (rec) {
    for (const key of PROMPT_KEYS) {
      const nested = rec[key];
      if (typeof nested === "string" && nested.trim()) {
        return sanitizePromptText(nested);
      }
    }
  }
  return "";
}

function readRowVideoPrompt(row: Record<string, unknown>): string {
  for (const key of PROMPT_KEYS) {
    const coerced = coercePromptValue(row[key]);
    if (coerced) return coerced;
  }
  // Nested common shapes: { shot: { prompt } } / { data: "..." }
  for (const nestedKey of ["shot", "data", "result", "item"]) {
    const nested = asRecord(row[nestedKey]);
    if (!nested) continue;
    const fromNested = readRowVideoPrompt(nested);
    if (fromNested) return fromNested;
  }
  return "";
}

export function sanitizePromptText(raw: string): string {
  let text = raw.replace(/^\uFEFF/, "").trim();
  // Strip a single wrapping quote pair.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  // Drop a leading standalone title line like "镜头1：" if the rest is substantial.
  text = text.replace(/^(?:分镜|镜头|Shot|SHOT)\s*0*\d+\s*[：:]\s*/u, "");
  return text.trim();
}

function rowsToPrompts(rows: Record<string, unknown>[]): {
  prompts: ParsedStoryboardPrompt[];
  invalidCount: number;
  duplicateIdCount: number;
} {
  const prompts: ParsedStoryboardPrompt[] = [];
  let invalidCount = 0;
  let duplicateIdCount = 0;
  const seenIds = new Set<string>();

  for (const row of rows) {
    const videoPrompt = readRowVideoPrompt(row);
    if (!videoPrompt) {
      invalidCount += 1;
      continue;
    }
    const sourceShotId = readRowShotId(row);
    const sourceShotNumber = readRowShotNumber(row);
    if (sourceShotId) {
      if (seenIds.has(sourceShotId)) {
        duplicateIdCount += 1;
        continue;
      }
      seenIds.add(sourceShotId);
    }
    prompts.push({
      ...(sourceShotId ? { sourceShotId } : {}),
      ...(sourceShotNumber != null ? { sourceShotNumber } : {}),
      videoPrompt,
    });
  }
  return { prompts, invalidCount, duplicateIdCount };
}

function pickBestRowArray(
  arrays: Record<string, unknown>[][],
): Record<string, unknown>[] | null {
  if (arrays.length === 0) return null;
  let best: Record<string, unknown>[] | null = null;
  let bestScore = -1;
  for (const rows of arrays) {
    let score = 0;
    for (const row of rows) {
      if (readRowVideoPrompt(row)) score += 2;
      if (readRowShotId(row) || readRowShotNumber(row) != null) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = rows;
    }
  }
  return best;
}

function parseFromJsonValue(
  value: unknown,
  parser: StoryboardResponseParser,
): ParseStoryboardModelResponseResult | null {
  const arrays = collectRowArrays(value);
  const rows = pickBestRowArray(arrays);
  if (!rows || rows.length === 0) return null;
  const { prompts, invalidCount, duplicateIdCount } = rowsToPrompts(rows);
  if (prompts.length === 0) {
    return {
      prompts: [],
      parser,
      diagnostics: {
        candidateCount: rows.length,
        invalidCount: invalidCount || rows.length,
        duplicateIdCount,
      },
    };
  }
  return {
    prompts,
    parser,
    diagnostics: {
      candidateCount: rows.length,
      invalidCount,
      duplicateIdCount,
    },
  };
}

/**
 * Section / heading based formats:
 * [分镜01]... 【镜头02】... 镜头 1：... Shot 1: ...
 */
export function parseSectionTextPrompts(raw: string): ParsedStoryboardPrompt[] {
  const text = stripBom(raw)
    .replace(/^```(?:text|markdown|md|json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) return [];

  // Prefer rule-native [分镜NN｜...] blocks when present.
  const bracketBlocks = parseBracketShotBlocks(text);
  if (bracketBlocks.length > 0) return bracketBlocks;

  const headerRe =
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:【\s*(?:分镜|镜头)\s*0*(\d+)\s*】|(?:分镜|镜头|Shot|SHOT)\s*0*(\d+)\s*[：:]|(?:分镜|镜头|Shot|SHOT)\s*0*(\d+)\b)/giu;

  const starts: Array<{ index: number; shotNumber: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    const numRaw = m[1] || m[2] || m[3];
    const shotNumber = Number(numRaw);
    if (!Number.isFinite(shotNumber) || shotNumber <= 0) continue;
    const absIndex = m.index + (m[0].startsWith("\n") ? 1 : 0);
    const lineEnd = text.indexOf("\n", absIndex);
    const line = text.slice(absIndex, lineEnd === -1 ? text.length : lineEnd);
    if (/交接卡/.test(line) && /[→\->]/.test(line)) continue;
    starts.push({ index: absIndex, shotNumber });
  }

  if (starts.length === 0) {
    // Fallback: numbered list "1. ..." / "1、..." / "（1）..."
    const numberedRe =
      /(?:^|\n)\s*(?:[(（]\s*)?(\d{1,3})\s*[)）]?[.、．)]\s+/g;
    const numberedStarts: Array<{ index: number; shotNumber: number }> = [];
    let nm: RegExpExecArray | null;
    while ((nm = numberedRe.exec(text)) !== null) {
      const shotNumber = Number(nm[1]);
      if (!Number.isFinite(shotNumber) || shotNumber <= 0) continue;
      const absIndex = nm.index + (nm[0].startsWith("\n") ? 1 : 0);
      numberedStarts.push({ index: absIndex, shotNumber });
    }
    if (numberedStarts.length >= 2) {
      const prompts: ParsedStoryboardPrompt[] = [];
      for (let i = 0; i < numberedStarts.length; i += 1) {
        const cur = numberedStarts[i]!;
        const end =
          i + 1 < numberedStarts.length
            ? numberedStarts[i + 1]!.index
            : text.length;
        const block = sanitizePromptText(text.slice(cur.index, end));
        // Drop the leading "1. " marker from the stored prompt body.
        const body = block.replace(/^\s*(?:[(（]\s*)?\d{1,3}\s*[)）]?[.、．)]\s*/u, "");
        if (!body || body.length < 8) continue;
        prompts.push({ sourceShotNumber: cur.shotNumber, videoPrompt: body });
      }
      if (prompts.length > 0) return prompts;
    }
    return [];
  }

  const prompts: ParsedStoryboardPrompt[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const cur = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]!.index : text.length;
    const block = sanitizePromptText(text.slice(cur.index, end));
    if (!block) continue;
    prompts.push({ sourceShotNumber: cur.shotNumber, videoPrompt: block });
  }
  return prompts;
}

/** Rule-native `[分镜01｜总时长：…]` blocks including following handoff until next header. */
export function parseBracketShotBlocks(raw: string): ParsedStoryboardPrompt[] {
  const text = stripBom(raw);
  const headerRe = /\[分镜\s*0*(\d+)/gi;
  const matches: Array<{ index: number; shotNumber: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    matches.push({ index: m.index, shotNumber: Number(m[1]) });
  }
  if (matches.length === 0) {
    // Also accept 【分镜01】 / 【镜头02】
    const altRe = /【\s*(?:分镜|镜头)\s*0*(\d+)\s*】/giu;
    while ((m = altRe.exec(text)) !== null) {
      matches.push({ index: m.index, shotNumber: Number(m[1]) });
    }
  }
  if (matches.length === 0) return [];

  const prompts: ParsedStoryboardPrompt[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index;
    const end =
      i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const block = sanitizePromptText(text.slice(start, end));
    if (!block) continue;
    prompts.push({
      sourceShotNumber: matches[i]!.shotNumber,
      videoPrompt: block,
    });
  }
  return prompts;
}

export function parseStoryboardModelResponse(
  rawModelResponse: string,
): ParseStoryboardModelResponseResult {
  const empty: ParseStoryboardModelResponseResult = {
    prompts: [],
    parser: null,
    diagnostics: { candidateCount: 0, invalidCount: 0, duplicateIdCount: 0 },
  };

  if (typeof rawModelResponse !== "string" || !rawModelResponse.trim()) {
    return empty;
  }

  const stripped = stripBom(rawModelResponse);
  if (!stripped) return empty;

  // 1) Direct JSON.parse
  const direct = tryJsonParse(stripped);
  if (direct != null) {
    const parsed = parseFromJsonValue(direct, "json");
    if (parsed && parsed.prompts.length > 0) return parsed;
  }

  // 2) Markdown fence
  const fenced = stripMarkdownFence(stripped);
  if (fenced.wasFenced) {
    const fencedJson = tryJsonParse(fenced.text);
    if (fencedJson != null) {
      const parsed = parseFromJsonValue(fencedJson, "markdown_json");
      if (parsed && parsed.prompts.length > 0) return parsed;
    }
  }

  // 3) Embedded JSON candidates in prose
  const candidates = extractJsonCandidates(
    fenced.wasFenced ? fenced.text : stripped,
  );
  let bestEmbedded: ParseStoryboardModelResponseResult | null = null;
  for (const candidate of candidates) {
    const value = tryJsonParse(candidate);
    if (value == null) continue;
    const parsed = parseFromJsonValue(value, "embedded_json");
    if (!parsed) continue;
    if (
      !bestEmbedded ||
      parsed.prompts.length > bestEmbedded.prompts.length
    ) {
      bestEmbedded = parsed;
    }
  }
  if (bestEmbedded && bestEmbedded.prompts.length > 0) return bestEmbedded;

  // 4) Section / bracket text
  const sectionPrompts = parseSectionTextPrompts(stripped);
  if (sectionPrompts.length > 0) {
    return {
      prompts: sectionPrompts,
      parser: "section_text",
      diagnostics: {
        candidateCount: sectionPrompts.length,
        invalidCount: 0,
        duplicateIdCount: 0,
      },
    };
  }

  return {
    prompts: [],
    parser: bestEmbedded?.parser ?? (direct != null ? "json" : null),
    diagnostics: {
      candidateCount: bestEmbedded?.diagnostics.candidateCount ?? 0,
      invalidCount:
        bestEmbedded?.diagnostics.invalidCount ??
        (direct != null || candidates.length > 0 ? 1 : 0),
      duplicateIdCount: bestEmbedded?.diagnostics.duplicateIdCount ?? 0,
    },
  };
}
