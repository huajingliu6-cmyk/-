/**
 * Transport DTO for script.episodes.generate structured output.
 * Not an internal ScriptEpisode — IDs / timestamps are assigned on apply.
 */

import { z } from "zod";

export const SCRIPT_EPISODES_GENERATION_VERSION = 1 as const;

/** Align with UI episode number picker (第1–8集). */
export const SCRIPT_EPISODE_NUMBER_MIN = 1;
export const SCRIPT_EPISODE_NUMBER_MAX = 8;

export const SCRIPT_EPISODE_TITLE_MAX_CHARS = 80;
export const SCRIPT_EPISODE_CONTENT_MAX_CHARS = 4000;
export const SCRIPT_EPISODES_RAW_OUTPUT_MAX_CHARS = 12000;

const DangerousKeySchema = z
  .string()
  .refine(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
    { message: "危险字段名" },
  );

const EpisodeItemSchema = z
  .object({
    number: z
      .number()
      .int()
      .min(SCRIPT_EPISODE_NUMBER_MIN)
      .max(SCRIPT_EPISODE_NUMBER_MAX),
    title: z
      .string()
      .trim()
      .min(1, "标题不能为空")
      .max(SCRIPT_EPISODE_TITLE_MAX_CHARS, "标题过长"),
    content: z
      .string()
      .trim()
      .min(1, "正文不能为空")
      .max(SCRIPT_EPISODE_CONTENT_MAX_CHARS, "正文过长"),
  })
  .strict();

export const ScriptEpisodesGenerationDtoSchema = z
  .object({
    version: z.literal(SCRIPT_EPISODES_GENERATION_VERSION),
    episodes: z.array(EpisodeItemSchema).min(1).max(SCRIPT_EPISODE_NUMBER_MAX),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<number>();
    for (const ep of val.episodes) {
      if (seen.has(ep.number)) {
        ctx.addIssue({
          code: "custom",
          message: `集号 ${ep.number} 重复`,
          path: ["episodes"],
        });
      }
      seen.add(ep.number);
    }
  });

export type ScriptEpisodesGenerationDto = z.infer<
  typeof ScriptEpisodesGenerationDtoSchema
>;

export type ParseScriptEpisodesResult =
  | { ok: true; value: ScriptEpisodesGenerationDto }
  | {
      ok: false;
      code:
        | "SCRIPT_EPISODES_OUTPUT_INVALID"
        | "SCRIPT_EPISODES_COUNT_MISMATCH"
        | "SCRIPT_EPISODES_NUMBER_INVALID"
        | "SCRIPT_EPISODES_CONTENT_EMPTY";
      message: string;
    };

function stripSingleJsonFence(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  if (!fence) return null;
  return fence[1]!.trim();
}

function rejectDangerousKeys(value: unknown, path: string[]): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = rejectDangerousKeys(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const check = DangerousKeySchema.safeParse(key);
    if (!check.success) {
      return `包含危险字段：${key}`;
    }
    const hit = rejectDangerousKeys(
      (value as Record<string, unknown>)[key],
      [...path, key],
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Parse model output: pure JSON object, or one ```json fence.
 * Rejects trailing/leading prose, JSON5, comments, multiple objects.
 */
export function parseScriptEpisodesGenerationOutput(
  raw: string,
  options?: { expectedEpisodeNumber?: number; expectedCount?: number },
): ParseScriptEpisodesResult {
  if (raw.length > SCRIPT_EPISODES_RAW_OUTPUT_MAX_CHARS) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: "模型输出超过长度上限",
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_CONTENT_EMPTY",
      message: "模型输出为空",
    };
  }

  let jsonText = trimmed;
  const fenced = stripSingleJsonFence(trimmed);
  if (fenced !== null) {
    jsonText = fenced;
  } else if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: "模型输出必须是单个 JSON 对象或单一 json 代码围栏",
    };
  }

  // Reject JSON5 / comments / multiple top-level values via strict JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: "模型输出不是合法 JSON",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: "模型输出必须是 JSON 对象",
    };
  }

  const danger = rejectDangerousKeys(parsed, []);
  if (danger) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: danger,
    };
  }

  const validated = ScriptEpisodesGenerationDtoSchema.safeParse(parsed);
  if (!validated.success) {
    const msg = validated.error.issues[0]?.message ?? "结构化剧集校验失败";
    if (/正文不能为空|标题不能为空/.test(msg)) {
      return {
        ok: false,
        code: "SCRIPT_EPISODES_CONTENT_EMPTY",
        message: msg,
      };
    }
    if (/集号|number|重复/.test(msg)) {
      return {
        ok: false,
        code: "SCRIPT_EPISODES_NUMBER_INVALID",
        message: msg,
      };
    }
    return {
      ok: false,
      code: "SCRIPT_EPISODES_OUTPUT_INVALID",
      message: msg,
    };
  }

  const expectedCount = options?.expectedCount ?? 1;
  if (validated.data.episodes.length !== expectedCount) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_COUNT_MISMATCH",
      message: `期望 ${expectedCount} 集，实际 ${validated.data.episodes.length} 集`,
    };
  }

  const expectedNumber = options?.expectedEpisodeNumber;
  if (
    typeof expectedNumber === "number" &&
    validated.data.episodes[0]!.number !== expectedNumber
  ) {
    return {
      ok: false,
      code: "SCRIPT_EPISODES_NUMBER_INVALID",
      message: `期望第 ${expectedNumber} 集，实际第 ${validated.data.episodes[0]!.number} 集`,
    };
  }

  return { ok: true, value: validated.data };
}

export function outlineContentFingerprint(outlineText: string): string {
  return outlineText.replace(/\r\n/g, "\n");
}
