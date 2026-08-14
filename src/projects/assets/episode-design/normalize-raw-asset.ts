/**
 * Loose model output → strict canonical EpisodeAssetDesign asset items.
 * Unknown design fields never enter the canonical DTO; they become warnings.
 */

import { normalizeAssetName } from "@/projects/storyboard/hash";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";
import {
  AssetItemSchema,
  EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS,
  EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS,
  EPISODE_ASSET_DESIGN_GENERATION_VERSION,
  EPISODE_ASSET_DESIGN_MAX_ASSETS,
  EPISODE_ASSET_DESIGN_MAX_PER_TYPE,
  EPISODE_ASSET_DESIGN_NAME_MAX_CHARS,
} from "@/projects/assets/episode-design/schema";

export type AssetDesignType = "character" | "scene" | "prop" | "audio";

export type ParseAssetWarning = {
  code: string;
  message: string;
  assetIndex?: number;
  assetName?: string;
  field?: string;
};

export type RejectedAssetItem = {
  index: number;
  name?: string;
  reason: string;
  code: string;
};

export type CanonicalAssetItem = EpisodeAssetDesignGenerationDto["assets"][number];

const TYPE_ALIASES: Record<string, AssetDesignType> = {
  character: "character",
  char: "character",
  person: "character",
  people: "character",
  人物: "character",
  角色: "character",
  角色卡: "character",
  scene: "scene",
  set: "scene",
  location: "scene",
  place: "scene",
  场景: "scene",
  地点: "scene",
  prop: "prop",
  props: "prop",
  item: "prop",
  object: "prop",
  道具: "prop",
  物品: "prop",
  audio: "audio",
  sound: "audio",
  music: "audio",
  sfx: "audio",
  音频: "audio",
  音乐: "audio",
  音效: "audio",
  旁白: "audio",
  配音: "audio",
};

const AUDIO_KIND_ALIASES: Record<string, "music" | "sfx" | "narration" | "voice"> =
  {
    music: "music",
    bgm: "music",
    音乐: "music",
    配乐: "music",
    sfx: "sfx",
    sound: "sfx",
    effect: "sfx",
    音效: "sfx",
    narration: "narration",
    narrate: "narration",
    旁白: "narration",
    voice: "voice",
    dialogue: "voice",
    配音: "voice",
    人声: "voice",
  };

const ROOT_LIST_KEYS = [
  "assets",
  "items",
  "resources",
  "asset_list",
  "assetList",
  "results",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function mergeTextPreferDetailed(
  primary: string | undefined,
  secondary: string | undefined,
): string | undefined {
  const a = primary?.trim() ?? "";
  const b = secondary?.trim() ?? "";
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  if (a === b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n${b}`;
}

function resolveAssetType(raw: unknown): AssetDesignType | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const direct = TYPE_ALIASES[key] ?? TYPE_ALIASES[raw.trim()];
  return direct ?? null;
}

function resolveAudioKind(
  raw: unknown,
): "music" | "sfx" | "narration" | "voice" | undefined {
  if (typeof raw !== "string") return undefined;
  const key = raw.trim().toLowerCase();
  return AUDIO_KIND_ALIASES[key] ?? AUDIO_KIND_ALIASES[raw.trim()];
}

function stringArrayToDescription(value: unknown[]): string | null {
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.length > 0 ? parts.join("；") : "";
}

function appendDescription(
  target: Record<string, string>,
  extra: string | undefined,
): void {
  if (!extra?.trim()) return;
  target.description = clip(
    mergeTextPreferDetailed(target.description, extra) ?? extra,
    EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS,
  );
}

/**
 * Extract a loose asset array from a parsed root object.
 */
export function extractRawAssetList(root: unknown): unknown[] | null {
  const obj = asRecord(root);
  if (!obj) return null;
  for (const key of ROOT_LIST_KEYS) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  const nested = asRecord(obj.data) ?? asRecord(obj.result);
  if (nested) {
    for (const key of ROOT_LIST_KEYS) {
      const value = nested[key];
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

export function normalizeRawAsset(
  raw: unknown,
  index: number,
):
  | {
      ok: true;
      value: CanonicalAssetItem;
      warnings: ParseAssetWarning[];
    }
  | {
      ok: false;
      rejected: RejectedAssetItem;
      warnings: ParseAssetWarning[];
    } {
  const warnings: ParseAssetWarning[] = [];
  const obj = asRecord(raw);
  if (!obj) {
    return {
      ok: false,
      rejected: {
        index,
        reason: "资产项必须是对象",
        code: "ASSET_NOT_OBJECT",
      },
      warnings,
    };
  }

  const type =
    resolveAssetType(obj.type) ??
    resolveAssetType(obj.assetType) ??
    resolveAssetType(obj.asset_type) ??
    resolveAssetType(obj.kind) ??
    resolveAssetType(obj.category);
  if (!type) {
    return {
      ok: false,
      rejected: {
        index,
        name: pickString(obj, ["name", "title", "label", "名称"]),
        reason: "无法识别资产类型",
        code: "ASSET_TYPE_UNKNOWN",
      },
      warnings,
    };
  }

  const name = pickString(obj, ["name", "title", "label", "名称", "assetName"]);
  if (!name) {
    return {
      ok: false,
      rejected: {
        index,
        reason: "资产名称不能为空",
        code: "ASSET_NAME_EMPTY",
      },
      warnings,
    };
  }
  if (name.length > EPISODE_ASSET_DESIGN_NAME_MAX_CHARS) {
    return {
      ok: false,
      rejected: {
        index,
        name: name.slice(0, 40),
        reason: "资产名称过长",
        code: "ASSET_NAME_TOO_LONG",
      },
      warnings,
    };
  }

  const topDescription = pickString(obj, [
    "description",
    "desc",
    "summary",
    "描述",
  ]);
  const topUsage = pickString(obj, [
    "usageInEpisode",
    "usage_in_episode",
    "episodeUsage",
    "本集用法",
  ]);
  const topEvidence = pickString(obj, ["evidence", "quote", "source", "证据"]);

  const designRaw = obj.design;
  const designFields: Record<string, string> = {};
  const unmappedSafe: string[] = [];

  const ingestDesignObject = (source: Record<string, unknown>) => {
    const knownKeys = new Set<string>();
    const take = (aliases: string[], canonical: string, max: number) => {
      const value = pickString(source, aliases);
      if (!value) return;
      knownKeys.add(canonical);
      for (const a of aliases) knownKeys.add(a);
      designFields[canonical] = clip(
        mergeTextPreferDetailed(designFields[canonical], value) ?? value,
        max,
      );
    };

    take(["description", "desc", "summary", "prompt", "concept", "描述"], "description", EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS);
    take(
      ["usageInEpisode", "usage_in_episode", "episodeUsage", "本集用法"],
      "usageInEpisode",
      1000,
    );
    take(["evidence", "quote", "source", "证据"], "evidence", EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS);

    if (type === "character") {
      take(["appearance", "look", "visual", "外观", "外貌"], "appearance", 500);
      take(["clothing", "costume", "outfit", "服装", "服饰"], "clothing", 500);
      take(["role", "角色定位", "定位"], "role", 200);
      if (!designFields.appearance) {
        const promptLike = pickString(source, ["prompt", "concept", "描述"]);
        if (promptLike) {
          designFields.appearance = clip(promptLike, 500);
        }
      }
    } else if (type === "scene") {
      take(["location", "place", "set", "地点", "场景位置"], "location", 500);
      take(["timeOfDay", "time_of_day", "time", "时段", "时间"], "timeOfDay", 100);
      take(["style", "visual_style", "visualStyle", "风格"], "style", 500);
      if (!designFields.location) {
        const promptLike = pickString(source, ["prompt", "concept"]);
        if (promptLike) designFields.location = clip(promptLike, 500);
      }
      for (const soft of ["lighting", "mood", "props", "atmosphere", "光影", "氛围"]) {
        const softVal = pickString(source, [soft]);
        if (softVal) {
          knownKeys.add(soft);
          appendDescription(designFields, `${soft}: ${softVal}`);
        }
      }
    } else if (type === "prop") {
      take(["propType", "prop_type", "category", "类型"], "propType", 200);
      take(["usage", "function", "用途", "用法"], "usage", 1000);
      if (!designFields.usage) {
        const promptLike = pickString(source, ["prompt", "concept"]);
        if (promptLike) designFields.usage = clip(promptLike, 1000);
      }
    } else if (type === "audio") {
      const kind =
        resolveAudioKind(source.audioKind) ??
        resolveAudioKind(source.audio_kind) ??
        resolveAudioKind(source.category) ??
        resolveAudioKind(source.kind);
      if (kind) {
        knownKeys.add("audioKind");
        knownKeys.add("audio_kind");
        knownKeys.add("category");
        knownKeys.add("kind");
        designFields.audioKind = kind;
      }
    }

    for (const [key, value] of Object.entries(source)) {
      if (knownKeys.has(key)) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim()) {
        unmappedSafe.push(`${key}: ${value.trim()}`);
        warnings.push({
          code: "UNMAPPED_DESIGN_FIELD",
          message: `未映射设计字段已并入描述：${key}`,
          assetIndex: index,
          assetName: name,
          field: key,
        });
      } else if (typeof value === "number" || typeof value === "boolean") {
        unmappedSafe.push(`${key}: ${String(value)}`);
        warnings.push({
          code: "UNMAPPED_DESIGN_FIELD",
          message: `未映射设计字段已并入描述：${key}`,
          assetIndex: index,
          assetName: name,
          field: key,
        });
      } else {
        warnings.push({
          code: "DROPPED_COMPLEX_FIELD",
          message: `无法安全映射的复杂字段已忽略：${key}`,
          assetIndex: index,
          assetName: name,
          field: key,
        });
      }
    }
  };

  if (typeof designRaw === "string") {
    const text = designRaw.trim();
    if (text) {
      if (type === "character") {
        designFields.appearance = clip(text, 500);
        designFields.description = clip(text, EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS);
      } else if (type === "scene") {
        designFields.location = clip(text, 500);
        designFields.description = clip(text, EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS);
      } else if (type === "prop") {
        designFields.usage = clip(text, 1000);
        designFields.description = clip(text, EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS);
      } else {
        designFields.description = clip(text, EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS);
      }
    }
  } else if (Array.isArray(designRaw)) {
    const joined = stringArrayToDescription(designRaw);
    if (joined === null) {
      return {
        ok: false,
        rejected: {
          index,
          name,
          reason: "design 数组只能包含字符串",
          code: "DESIGN_ARRAY_INVALID",
        },
        warnings,
      };
    }
    if (joined) {
      if (type === "character") designFields.appearance = clip(joined, 500);
      else if (type === "scene") designFields.location = clip(joined, 500);
      else if (type === "prop") designFields.usage = clip(joined, 1000);
      designFields.description = clip(
        joined,
        EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS,
      );
    }
  } else if (designRaw === null || designRaw === undefined) {
    // ok — rely on top-level fields
  } else if (asRecord(designRaw)) {
    ingestDesignObject(asRecord(designRaw)!);
  } else {
    return {
      ok: false,
      rejected: {
        index,
        name,
        reason: "design 形态无效",
        code: "DESIGN_SHAPE_INVALID",
      },
      warnings,
    };
  }

  if (unmappedSafe.length > 0) {
    appendDescription(designFields, unmappedSafe.join("；"));
  }

  // Top-level usage/evidence migrate into design; design wins, then merge non-dup.
  if (topUsage) {
    designFields.usageInEpisode = clip(
      mergeTextPreferDetailed(designFields.usageInEpisode, topUsage) ?? topUsage,
      1000,
    );
    if (!asRecord(designRaw)?.usageInEpisode && !asRecord(designRaw)?.usage_in_episode) {
      warnings.push({
        code: "USAGE_PROMOTED",
        message: "顶层 usageInEpisode 已迁移到 design.usageInEpisode",
        assetIndex: index,
        assetName: name,
        field: "usageInEpisode",
      });
    }
  }
  if (topEvidence) {
    designFields.evidence = clip(
      mergeTextPreferDetailed(designFields.evidence, topEvidence) ?? topEvidence,
      EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS,
    );
  }
  if (topDescription) {
    appendDescription(designFields, topDescription);
  }

  const canonicalDesign =
    Object.keys(designFields).length > 0 ? designFields : undefined;

  const candidate = {
    type,
    name,
    ...(topDescription
      ? {
          description: clip(
            topDescription,
            EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS,
          ),
        }
      : designFields.description
        ? {
            description: clip(
              designFields.description,
              EPISODE_ASSET_DESIGN_DESCRIPTION_MAX_CHARS,
            ),
          }
        : {}),
    ...(canonicalDesign ? { design: canonicalDesign } : {}),
    ...(designFields.evidence || topEvidence
      ? {
          evidence: clip(
            designFields.evidence ?? topEvidence ?? "",
            EPISODE_ASSET_DESIGN_EVIDENCE_MAX_CHARS,
          ),
        }
      : {}),
  };

  const validated = AssetItemSchema.safeParse(candidate);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return {
      ok: false,
      rejected: {
        index,
        name,
        reason: issue?.message ?? "资产项未通过内部结构校验",
        code: "ASSET_CANONICAL_INVALID",
      },
      warnings,
    };
  }

  return {
    ok: true,
    value: validated.data,
    warnings,
  };
}

function designInfoScore(asset: CanonicalAssetItem): number {
  const design = asset.design ? JSON.stringify(asset.design) : "";
  return (
    (asset.description?.length ?? 0) +
    design.length +
    (asset.evidence?.length ?? 0)
  );
}

function mergeTwoAssets(
  a: CanonicalAssetItem,
  b: CanonicalAssetItem,
): CanonicalAssetItem {
  const prefer = designInfoScore(a) >= designInfoScore(b) ? a : b;
  const other = prefer === a ? b : a;
  const preferDesign = (prefer.design ?? {}) as Record<string, string>;
  const otherDesign = (other.design ?? {}) as Record<string, string>;
  const mergedDesign: Record<string, string> = { ...otherDesign };
  for (const [key, value] of Object.entries(preferDesign)) {
    mergedDesign[key] = mergeTextPreferDetailed(value, otherDesign[key]) ?? value;
  }
  if (preferDesign.usageInEpisode || otherDesign.usageInEpisode) {
    mergedDesign.usageInEpisode =
      mergeTextPreferDetailed(
        preferDesign.usageInEpisode,
        otherDesign.usageInEpisode,
      ) ?? "";
  }
  if (preferDesign.evidence || otherDesign.evidence) {
    mergedDesign.evidence =
      mergeTextPreferDetailed(preferDesign.evidence, otherDesign.evidence) ?? "";
  }
  return {
    type: prefer.type,
    name: prefer.name.length >= other.name.length ? prefer.name : other.name,
    description: mergeTextPreferDetailed(prefer.description, other.description),
    design: Object.keys(mergedDesign).length > 0 ? (mergedDesign as CanonicalAssetItem["design"]) : undefined,
    evidence: mergeTextPreferDetailed(prefer.evidence, other.evidence),
  };
}

export function mergeCanonicalAssets(
  assets: CanonicalAssetItem[],
): { assets: CanonicalAssetItem[]; warnings: ParseAssetWarning[] } {
  const warnings: ParseAssetWarning[] = [];
  const byKey = new Map<string, CanonicalAssetItem>();
  for (const asset of assets) {
    const key = `${asset.type}|${normalizeAssetName(asset.name)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, asset);
      continue;
    }
    byKey.set(key, mergeTwoAssets(existing, asset));
    warnings.push({
      code: "ASSET_MERGED",
      message: `已合并同名同类资产：${asset.name}`,
      assetName: asset.name,
    });
  }
  return { assets: [...byKey.values()], warnings };
}

export function enforceAssetLimits(
  assets: CanonicalAssetItem[],
): { assets: CanonicalAssetItem[]; warnings: ParseAssetWarning[] } {
  const warnings: ParseAssetWarning[] = [];
  const perType = new Map<AssetDesignType, number>();
  const kept: CanonicalAssetItem[] = [];
  for (const asset of assets) {
    const typeCount = perType.get(asset.type) ?? 0;
    if (typeCount >= EPISODE_ASSET_DESIGN_MAX_PER_TYPE) {
      warnings.push({
        code: "PER_TYPE_LIMIT",
        message: `${asset.type} 超过每类上限 ${EPISODE_ASSET_DESIGN_MAX_PER_TYPE}，已跳过：${asset.name}`,
        assetName: asset.name,
      });
      continue;
    }
    if (kept.length >= EPISODE_ASSET_DESIGN_MAX_ASSETS) {
      warnings.push({
        code: "TOTAL_LIMIT",
        message: `资产总数超过上限 ${EPISODE_ASSET_DESIGN_MAX_ASSETS}，已跳过后续项`,
        assetName: asset.name,
      });
      break;
    }
    perType.set(asset.type, typeCount + 1);
    kept.push(asset);
  }
  return { assets: kept, warnings };
}

export function buildCanonicalDto(
  assets: CanonicalAssetItem[],
): EpisodeAssetDesignGenerationDto {
  return {
    version: EPISODE_ASSET_DESIGN_GENERATION_VERSION,
    assets,
  };
}
