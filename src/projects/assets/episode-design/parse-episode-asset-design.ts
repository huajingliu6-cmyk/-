import { recoverJsonObjectText } from "@/projects/assets/episode-design/json-text-repair";
import {
  buildCanonicalDto,
  enforceAssetLimits,
  extractRawAssetList,
  mergeCanonicalAssets,
  normalizeRawAsset,
  type CanonicalAssetItem,
  type ParseAssetWarning,
  type RejectedAssetItem,
} from "@/projects/assets/episode-design/normalize-raw-asset";
import { rejectDangerousKeys } from "@/projects/assets/episode-design/reject-dangerous-keys";
import {
  EPISODE_ASSET_DESIGN_RAW_OUTPUT_MAX_CHARS,
  type EpisodeAssetDesignGenerationDto,
} from "@/projects/assets/episode-design/schema";

export type ParseEpisodeAssetDesignResult =
  | {
      ok: true;
      value: EpisodeAssetDesignGenerationDto;
      warnings: ParseAssetWarning[];
      rejectedItems: RejectedAssetItem[];
      repaired?: boolean;
    }
  | {
      ok: false;
      code:
        | "EPISODE_ASSET_DESIGN_OUTPUT_INVALID"
        | "EPISODE_ASSET_DESIGN_CONTENT_EMPTY";
      message: string;
      warnings?: ParseAssetWarning[];
      rejectedItems?: RejectedAssetItem[];
    };

export type ParseEpisodeAssetDesignOptions = {
  /** Optional one-shot model format repair. Must not re-analyze the script. */
  repairWithModel?: (brokenText: string) => Promise<string | null>;
};

/** Root-level danger scan that defers asset-list items to per-item checks. */
function rejectDangerousKeysExceptAssetLists(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return rejectDangerousKeys(value);
  }
  const root = value as Record<string, unknown>;
  const clone: Record<string, unknown> = { ...root };
  for (const key of [
    "assets",
    "items",
    "resources",
    "asset_list",
    "assetList",
    "results",
  ]) {
    if (key in clone) delete clone[key];
  }
  if (clone.data && typeof clone.data === "object" && !Array.isArray(clone.data)) {
    const data = { ...(clone.data as Record<string, unknown>) };
    for (const key of [
      "assets",
      "items",
      "resources",
      "asset_list",
      "assetList",
      "results",
    ]) {
      if (key in data) delete data[key];
    }
    clone.data = data;
  }
  return rejectDangerousKeys(clone);
}

async function tryParseObjectText(
  jsonText: string,
  repairedFlag: boolean,
): Promise<ParseEpisodeAssetDesignResult | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "模型输出必须是 JSON 对象",
    };
  }

  const danger = rejectDangerousKeysExceptAssetLists(parsed);
  if (danger) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: danger,
    };
  }

  const list = extractRawAssetList(parsed);
  if (!list) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "缺少 assets/items/resources 资产列表",
    };
  }

  const warnings: ParseAssetWarning[] = [];
  const rejectedItems: RejectedAssetItem[] = [];
  const accepted: CanonicalAssetItem[] = [];

  for (let i = 0; i < list.length; i += 1) {
    // Safety: each item scanned before normalize projection.
    const itemDanger = rejectDangerousKeys(list[i], [String(i)]);
    if (itemDanger) {
      rejectedItems.push({
        index: i,
        reason: itemDanger,
        code: "DANGEROUS_KEYS",
      });
      continue;
    }
    const normalized = normalizeRawAsset(list[i], i);
    warnings.push(...normalized.warnings);
    if (!normalized.ok) {
      rejectedItems.push(normalized.rejected);
      continue;
    }
    accepted.push(normalized.value);
  }

  const merged = mergeCanonicalAssets(accepted);
  warnings.push(...merged.warnings);
  const limited = enforceAssetLimits(merged.assets);
  warnings.push(...limited.warnings);

  if (limited.assets.length === 0) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_CONTENT_EMPTY",
      message:
        rejectedItems.length > 0
          ? `没有有效资产（${rejectedItems.length} 项被拒绝）`
          : "模型输出为空资产列表",
      warnings,
      rejectedItems,
    };
  }

  return {
    ok: true,
    value: buildCanonicalDto(limited.assets),
    warnings,
    rejectedItems,
    repaired: repairedFlag || undefined,
  };
}

/**
 * Tolerant parser: loose envelope → per-item normalize → strict canonical DTO.
 * Whole-batch failure only when JSON unrecoverable, dangerous keys, or zero valid assets.
 */
export async function parseEpisodeAssetDesignOutputAsync(
  raw: string,
  options: ParseEpisodeAssetDesignOptions = {},
): Promise<ParseEpisodeAssetDesignResult> {
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

  const recovered = recoverJsonObjectText(trimmed);
  if (recovered) {
    const first = await tryParseObjectText(
      recovered.text,
      recovered.method === "repair",
    );
    if (first) return first;
  }

  if (options.repairWithModel) {
    let fixed: string | null = null;
    try {
      fixed = await options.repairWithModel(trimmed.slice(0, 80_000));
    } catch {
      fixed = null;
    }
    if (fixed?.trim()) {
      const recoveredFixed = recoverJsonObjectText(fixed);
      if (recoveredFixed) {
        const second = await tryParseObjectText(recoveredFixed.text, true);
        if (second) {
          if (second.ok) return { ...second, repaired: true };
          return second;
        }
      }
    }
  }

  return {
    ok: false,
    code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
    message: recovered
      ? "模型输出无法归一化为有效资产"
      : "模型输出不是合法 JSON",
  };
}

/** Sync wrapper used by most call sites (no model repair). */
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
  const recovered = recoverJsonObjectText(trimmed);
  if (!recovered) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "模型输出不是合法 JSON",
    };
  }

  // Sync path mirrors async without await — inline the same pipeline.
  let parsed: unknown;
  try {
    parsed = JSON.parse(recovered.text);
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

  const danger = rejectDangerousKeysExceptAssetLists(parsed);
  if (danger) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: danger,
    };
  }

  const list = extractRawAssetList(parsed);
  if (!list) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_OUTPUT_INVALID",
      message: "缺少 assets/items/resources 资产列表",
    };
  }

  const warnings: ParseAssetWarning[] = [];
  const rejectedItems: RejectedAssetItem[] = [];
  const accepted: CanonicalAssetItem[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const itemDanger = rejectDangerousKeys(list[i], [String(i)]);
    if (itemDanger) {
      rejectedItems.push({
        index: i,
        reason: itemDanger,
        code: "DANGEROUS_KEYS",
      });
      continue;
    }
    const normalized = normalizeRawAsset(list[i], i);
    warnings.push(...normalized.warnings);
    if (!normalized.ok) {
      rejectedItems.push(normalized.rejected);
      continue;
    }
    accepted.push(normalized.value);
  }

  const merged = mergeCanonicalAssets(accepted);
  warnings.push(...merged.warnings);
  const limited = enforceAssetLimits(merged.assets);
  warnings.push(...limited.warnings);

  if (limited.assets.length === 0) {
    return {
      ok: false,
      code: "EPISODE_ASSET_DESIGN_CONTENT_EMPTY",
      message:
        rejectedItems.length > 0
          ? `没有有效资产（${rejectedItems.length} 项被拒绝）`
          : "模型输出为空资产列表",
      warnings,
      rejectedItems,
    };
  }

  return {
    ok: true,
    value: buildCanonicalDto(limited.assets),
    warnings,
    rejectedItems,
    repaired: recovered.method === "repair" || undefined,
  };
}
