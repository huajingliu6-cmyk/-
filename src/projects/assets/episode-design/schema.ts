/**
 * Transport DTO for asset.episode-design.generate structured output (canonical).
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

const AssetTypeSchema = z.enum(["character", "scene", "prop", "audio"]);

export const CharacterDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    appearance: z.string().max(500).optional(),
    clothing: z.string().max(500).optional(),
    role: z.string().max(200).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

export const SceneDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    timeOfDay: z.string().max(100).optional(),
    location: z.string().max(500).optional(),
    style: z.string().max(500).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

export const PropDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    propType: z.string().max(200).optional(),
    usage: z.string().max(1000).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

export const AudioDesignSchema = z
  .object({
    description: z.string().max(EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS).optional(),
    audioKind: z.enum(["music", "sfx", "narration", "voice"]).optional(),
    usageInEpisode: z.string().max(1000).optional(),
    evidence: z.string().max(EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS).optional(),
  })
  .strict();

export const AssetItemSchema = z
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

/**
 * Canonical internal DTO. Prefer parseEpisodeAssetDesignOutput for model output;
 * this schema remains the strict post-normalize contract.
 */
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

export type {
  ParseAssetWarning,
  RejectedAssetItem,
} from "@/projects/assets/episode-design/normalize-raw-asset";

export { rejectDangerousKeys } from "@/projects/assets/episode-design/reject-dangerous-keys";

// parseEpisodeAssetDesignOutput lives in parse-episode-asset-design.ts to avoid
// circular imports with the canonical Zod schemas above.
export {
  parseEpisodeAssetDesignOutput,
  parseEpisodeAssetDesignOutputAsync,
  type ParseEpisodeAssetDesignResult,
} from "@/projects/assets/episode-design/parse-episode-asset-design";
