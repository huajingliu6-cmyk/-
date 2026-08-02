/**
 * Transport DTO for script.split.generate structured output (block boundaries only).
 */

import { z } from "zod";

export const SCRIPT_SPLIT_TITLE_MAX_CHARS = 120;
export const SCRIPT_SPLIT_RAW_OUTPUT_MAX_CHARS = 24000;

const DangerousKeySchema = z
  .string()
  .refine(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
    { message: "危险字段名" },
  );

const BlockIdSchema = z
  .string()
  .trim()
  .regex(/^B\d{6}$/, "块 ID 格式无效");

const EpisodeBoundarySchema = z
  .object({
    episodeNumber: z.number().int().min(1),
    title: z
      .string()
      .trim()
      .min(1, "标题不能为空")
      .max(SCRIPT_SPLIT_TITLE_MAX_CHARS, "标题过长"),
    startBlockId: BlockIdSchema,
    endBlockId: BlockIdSchema,
  })
  .strict();

export const ScriptSplitModelOutputSchema = z
  .object({
    episodes: z.array(EpisodeBoundarySchema).min(1),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<number>();
    for (const ep of val.episodes) {
      if (seen.has(ep.episodeNumber)) {
        ctx.addIssue({
          code: "custom",
          message: `集号 ${ep.episodeNumber} 重复`,
          path: ["episodes"],
        });
      }
      seen.add(ep.episodeNumber);
    }
  });

export type ScriptSplitModelOutput = z.infer<typeof ScriptSplitModelOutputSchema>;

export type ParseScriptSplitResult =
  | { ok: true; value: ScriptSplitModelOutput }
  | {
      ok: false;
      code:
        | "SCRIPT_SPLIT_OUTPUT_INVALID"
        | "SCRIPT_SPLIT_NUMBER_INVALID"
        | "SCRIPT_SPLIT_CONTENT_EMPTY";
      message: string;
    };

export function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  if (fence) return fence[1]!.trim();
  return trimmed;
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

export function parseScriptSplitModelOutput(
  raw: string,
): ParseScriptSplitResult {
  if (raw.length > SCRIPT_SPLIT_RAW_OUTPUT_MAX_CHARS) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_OUTPUT_INVALID",
      message: "模型输出超过长度上限",
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_CONTENT_EMPTY",
      message: "模型输出为空",
    };
  }

  const jsonText = stripMarkdownCodeFence(trimmed);
  if (jsonText === trimmed) {
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_OUTPUT_INVALID",
        message: "模型输出必须是单个 JSON 对象或单一 json 代码围栏",
      };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_OUTPUT_INVALID",
      message: "模型输出不是合法 JSON",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_OUTPUT_INVALID",
      message: "模型输出必须是 JSON 对象",
    };
  }

  const danger = rejectDangerousKeys(parsed, []);
  if (danger) {
    return {
      ok: false,
      code: "SCRIPT_SPLIT_OUTPUT_INVALID",
      message: danger,
    };
  }

  const validated = ScriptSplitModelOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const msg = validated.error.issues[0]?.message ?? "结构化分集边界校验失败";
    if (/标题不能为空/.test(msg)) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_CONTENT_EMPTY",
        message: msg,
      };
    }
    if (/集号|重复/.test(msg)) {
      return {
        ok: false,
        code: "SCRIPT_SPLIT_NUMBER_INVALID",
        message: msg,
      };
    }
    return {
      ok: false,
      code: "SCRIPT_SPLIT_OUTPUT_INVALID",
      message: msg,
    };
  }

  return { ok: true, value: validated.data };
}
