import { jsonrepair } from "jsonrepair";
import { EPISODE_ASSET_DESIGN_RAW_OUTPUT_MAX_CHARS } from "@/projects/assets/episode-design/schema";

function stripBom(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

function stripSingleJsonFence(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  if (!fence) return null;
  return fence[1]!.trim();
}

function stripFirstJsonFence(raw: string): string | null {
  const inner = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw.trim());
  if (!inner) return null;
  return inner[1]!.trim();
}

/** Extract balanced `{...}` candidates; longer first. No eval. */
export function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  const openers: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      openers.push(i);
      continue;
    }
    if (ch === "}" && openers.length > 0) {
      const start = openers.pop()!;
      const slice = text.slice(start, i + 1).trim();
      if (slice.length >= 2) candidates.push(slice);
    }
  }
  return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

export type JsonTextRecovery = {
  text: string;
  method: "raw" | "fence" | "embedded" | "repair";
};

/**
 * Recover a JSON object text from model output using fence / embedded / jsonrepair.
 * Does not call the model.
 */
export function recoverJsonObjectText(raw: string): JsonTextRecovery | null {
  if (raw.length > EPISODE_ASSET_DESIGN_RAW_OUTPUT_MAX_CHARS) return null;
  const trimmed = stripBom(raw);
  if (!trimmed) return null;

  const attempts: Array<{ text: string; method: JsonTextRecovery["method"] }> = [];

  const fencedExact = stripSingleJsonFence(trimmed);
  if (fencedExact) attempts.push({ text: fencedExact, method: "fence" });
  const fencedFirst = stripFirstJsonFence(trimmed);
  if (fencedFirst && fencedFirst !== fencedExact) {
    attempts.push({ text: fencedFirst, method: "fence" });
  }
  if (trimmed.startsWith("{")) {
    attempts.push({ text: trimmed, method: "raw" });
  }
  for (const candidate of extractJsonObjectCandidates(trimmed).slice(0, 5)) {
    attempts.push({ text: candidate, method: "embedded" });
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt.text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return attempt;
      }
    } catch {
      try {
        const repaired = jsonrepair(attempt.text);
        const parsed = JSON.parse(repaired) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { text: repaired, method: "repair" };
        }
      } catch {
        // continue
      }
    }
  }

  // Last resort: repair the whole trimmed payload.
  try {
    const repaired = jsonrepair(trimmed);
    const parsed = JSON.parse(repaired) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { text: repaired, method: "repair" };
    }
  } catch {
    return null;
  }
  return null;
}
