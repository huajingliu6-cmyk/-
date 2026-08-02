/**
 * Transport DTO for asset.episode-design.generate structured output.
 */

import { z } from "zod";
import { normalizeAssetName } from "@/projects/storyboard/hash";

export const EPISODE_ASSET_DESIGN_GENERATION_VERSION = 1 as const;

export const EPISODE_ASSET_DESIGN_MAX_ASSETS = 100;
export const EPISODE_ASSET_DESIGN_MAX_PER_TYPE = 40;
export const EPISODE_ASSET_DESIGN_NAME_MAX_CHARS = 100;
export const EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS = 5000;
export const EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS = 500;
export const EPISODE_ASSET_DESIGN_RAW_OUTPUT_MAX_CHARS = 120_000;

const REJECTED_KEY_PATTERN =
  /^(id|existingAssetId|libraryAssetId|projectId|modelId|providerModelId|base64)$/i;

const DangerousKeySchema = z
  .string()
  .refine(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
    { message: "危险字段名" },
  );

const AssetTypeSchema = z.enum(["character", "scene", "prop", "audio"]);

const CharacterDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    appearance: z.string().max(500).optional(),
    clothing: z.string().max(500).optional(),
    role: z.string().max(200).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

const SceneDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    timeOfDay: z.string().max(100).optional(),
    location: z.string().max(500).optional(),
    style: z.string().max(500).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

const PropDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    propType: z.string().max(200).optional(),
    usage: z.string().max(1000).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

const AudioDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    audioKind: z.enum(["music", "sfx", "narration", "voice"]).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

const AssetItemSchema = z
  .object({
    type: AssetTypeSchema,
    name: z
      .string()
      .trim()
      .min(1, "资产名称不能为空")
      .max(EPISODE_ASSET_DESIGN_NAME_MAX_CHARS, "资产名称过长"),
    description: z
      .string()
      .max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS, "描述过长")
      .optional(),
    design: z
      .union([
        CharacterDesignSchema,
        SceneDesignSchema,
        PropDesignSchema,
        AudioDesignSchema,
      ])
      .optional(),
    evidence: z
      .string()
      .max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS, "证据过长")
      .optional(),
  })
  .strict();

export const EpisodeAssetDesignGenerationDtoSchema = z
  .object({
    version: z.literal(EPISODE_ASSET_DESIGN_GENERATION_VERSION),
    assets: z
      .array(AssetItemSchema)
      .max(EPISODE_ASSET_DESIGN_MAX_ASSETS, "资产总数超过上限"),
  })
  .strict()
  .superRefine((val, ctx) => {
    const perType = new Map<string, number>();
    const seenNames = new Set<string>();
    for (const asset of val.assets) {
      const count = (perType.get(asset.type) ?? 0) + 1;
      perType.set(asset.type, count);
      if (count > EPISODE_ASSET_DESIGN_MAX_PER_TYPE) {
        ctx.addIssue({
          code: "custom",
          message: `${asset.type} 类型资产超过上限`,
          path: ["assets"],
        });
      }
      const key = `${asset.type}|${normalizeAssetName(asset.name)}`;
      if (seenNames.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `重复资产名称：${asset.name}`,
          path: ["assets"],
        });
      }
      seenNames.add(key);
    }
  });

export type EpisodeAssetDesignGenerationDto = z.infer<
  typeof EpisodeAssetDesignGenerationDtoSchema
>;

export type ParseEpisodeAssetDesignResult =
  | { ok: true; value: EpisodeAssetDesignGenerationDto }
  | {
      ok: false;
      code:
        | "EPISODE_ASSET_DESIGN_OUTPUT_INVALID"
        | "EPISODE_ASSET_DESIGN_CONTENT_EMPTY";
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
    if (REJECTED_KEY_PATTERN.test(key)) {
      return `包含不允许的字段：${key}`;
    }
    const lower = key.toLowerCase();
    if (lower.includes("base64") || lower.includes("filepath") || lower.includes("path")) {
      return `包含不允许的字段：${key}`;
    }
    const hit = rejectDangerousKeys(
      (value as Record<string, unknown>)[key],
      [...path, key],
    );
    if (hit) return hit;
  }
  return null;
}

export function parseEpisodeAssetDesignOutput(
  raw: string,
): ParseEpisodeAssetDesignResult {
  if (raw.length > EPISODE_ASSET_DESIGN_RAW_OUTPUT_MAX_CHARS) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "模型输出超过长度上限",
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_CONTENT_EMPTY",
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
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "模型输出必须是单个 JSON 对象或单一 json 代码围栏",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "模型输出不是合法 JSON",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "模型输出必须是 JSON 对象",
    };
  }

  const normalized = normalizeEpisodeAssetDesignPayload(parsed);
  const danger = rejectDangerousKeys(normalized, []);
  if (danger) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: danger,
    };
  }

  const validated = EpisodeAssetDesignGenerationDtoSchema.safeParse(normalized);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "";
    const rawMsg = issue?.message ?? "结构化资产设计校验失败";
    const msg =
      rawMsg === "Invalid input" || rawMsg === "Required"
        ? path
          ? `字段 ${path} 格式无效（design 须为对象，不能是纯文本）`
          : "资产设计字段格式无效（design 须为对象，不能是纯文本）"
        : rawMsg;
    if (/不能为空|为空/.test(msg)) {
      return {
        ok: false,
        code: "EPISODE_ASSET_DESIGN_CONTENT_EMPTY",
        message: msg,
      };
    }
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: msg,
    };
  }

  return { ok: true, value: validated.data };
}

/**
 * Models often return `design` as a long prose string. Coerce to the typed
 * object shape expected by the DTO so apply-generation does not fail with
 * Zod's opaque "Invalid input".
 */
function normalizeEpisodeAssetDesignPayload(parsed: object): object {
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.assets)) return parsed;
  return {
    ...root,
    assets: root.assets.map((asset) => {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        return asset;
      }
      const item = { ...(asset as Record<string, unknown>) };
      if (typeof item.design === "string") {
        const text = item.design.trim();
        const type = item.type;
        if (type === "character") {
          item.design = {
            appearance: text,
            description: text,
          };
        } else if (type === "scene") {
          item.design = {
            description: text,
            location: text,
          };
        } else if (type === "prop") {
          item.design = {
            description: text,
            usage: text,
          };
        } else if (type === "audio") {
          item.design = {
            description: text,
          };
        } else {
          item.design = { description: text };
        }
      }
      return item;
    }),
  };
}
