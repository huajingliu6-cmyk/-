import { randomUUID } from "crypto";
import type {
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { normalizeAssetName } from "@/projects/storyboard/hash";
import type {
  AssetKind,
  AssetMatchItem,
  MatchConfidence,
  MatchResolution,
} from "@/projects/storyboard/types";

export type MatchableAssets = Pick<
  ProjectAssetBundle,
  "characters" | "scenes" | "props" | "audios"
>;

type ExtractedRequirement = {
  assetType: AssetKind;
  extractedName: string;
  normalizedName: string;
  occurrences: number;
  firstOffset: number;
  otherOffsets: number[];
};

type NamedAsset = { id: string; name: string };

const MIN_NAME_LEN = 2;
const MAX_NAME_LEN = 24;

function isUsableName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= MIN_NAME_LEN &&
    trimmed.length <= MAX_NAME_LEN &&
    !/^[，,。！？\s\d]+$/.test(trimmed)
  );
}

function mergeRequirement(
  map: Map<string, ExtractedRequirement>,
  assetType: AssetKind,
  rawName: string,
  offset: number,
) {
  const extractedName = rawName.trim();
  if (!isUsableName(extractedName)) return;
  const normalizedName = normalizeAssetName(extractedName);
  if (!normalizedName) return;
  const key = `${assetType}|${normalizedName}`;
  const existing = map.get(key);
  if (existing) {
    existing.occurrences += 1;
    existing.otherOffsets.push(offset);
    return;
  }
  map.set(key, {
    assetType,
    extractedName,
    normalizedName,
    occurrences: 1,
    firstOffset: offset,
    otherOffsets: [],
  });
}

function extractWithPattern(
  scriptText: string,
  map: Map<string, ExtractedRequirement>,
  assetType: AssetKind,
  pattern: RegExp,
  groupIndex = 1,
) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(scriptText)) !== null) {
    const name = match[groupIndex];
    if (typeof name === "string") {
      mergeRequirement(map, assetType, name, match.index);
    }
  }
}

/** Conservative regex heuristics for confirmed Chinese script text. */
export function extractRequirements(scriptText: string): ExtractedRequirement[] {
  const map = new Map<string, ExtractedRequirement>();
  if (!scriptText.trim()) return [];

  extractWithPattern(scriptText, map, "character", /「([^」]{2,20})」/g);
  extractWithPattern(
    scriptText,
    map,
    "character",
    /([^\s，,。！？「」]{2,12})(?:说|道)[：:]/g,
  );
  extractWithPattern(
    scriptText,
    map,
    "character",
    /([^\s，,。！？「」]{2,12})出场/g,
  );
  extractWithPattern(
    scriptText,
    map,
    "character",
    /(?:出场|说道?|说)[：:]\s*([^\s，,。！？]{2,12})/g,
  );
  extractWithPattern(
    scriptText,
    map,
    "scene",
    /(?:INT|EXT|内景|外景)[\s/·\-—]*([^\n，,。！？]{2,30})/gi,
  );
  extractWithPattern(scriptText, map, "scene", /场景[：:]\s*([^\n，,。！？]{2,30})/g);
  extractWithPattern(scriptText, map, "prop", /道具[：:]\s*([^\n，,。！？]{2,20})/g);
  extractWithPattern(scriptText, map, "audio", /音效[：:]\s*([^\n，,。！？]{2,20})/g);
  extractWithPattern(scriptText, map, "audio", /音乐[：:]\s*([^\n，,。！？]{2,20})/g);

  return [...map.values()].sort((a, b) => a.firstOffset - b.firstOffset);
}

function assetsForKind(
  assets: MatchableAssets,
  assetType: AssetKind,
): NamedAsset[] {
  switch (assetType) {
    case "character":
      return assets.characters.map((item: CharacterAsset) => ({
        id: item.id,
        name: item.name,
      }));
    case "scene":
      return assets.scenes.map((item: SceneAsset) => ({
        id: item.id,
        name: item.name,
      }));
    case "prop":
      return assets.props.map((item: PropAsset) => ({
        id: item.id,
        name: item.name,
      }));
    case "audio":
      return assets.audios.map((item: AudioAsset) => ({
        id: item.id,
        name: item.name,
      }));
  }
}

export function matchAssetByName(
  extractedName: string,
  candidates: NamedAsset[],
): {
  matchedAssetId: string | null;
  matchedAssetName: string | null;
  confidence: MatchConfidence;
  resolution: MatchResolution;
} {
  const normalized = normalizeAssetName(extractedName);
  if (!normalized || candidates.length === 0) {
    return {
      matchedAssetId: null,
      matchedAssetName: null,
      confidence: "none",
      resolution: "unresolved",
    };
  }

  for (const candidate of candidates) {
    if (normalizeAssetName(candidate.name) === normalized) {
      return {
        matchedAssetId: candidate.id,
        matchedAssetName: candidate.name,
        confidence: "high",
        resolution: "matched",
      };
    }
  }

  for (const candidate of candidates) {
    const candidateNorm = normalizeAssetName(candidate.name);
    if (
      candidateNorm.includes(normalized) ||
      normalized.includes(candidateNorm)
    ) {
      return {
        matchedAssetId: candidate.id,
        matchedAssetName: candidate.name,
        confidence: "possible",
        resolution: "matched",
      };
    }
  }

  return {
    matchedAssetId: null,
    matchedAssetName: null,
    confidence: "none",
    resolution: "unresolved",
  };
}

function requirementKey(assetType: AssetKind, normalizedName: string): string {
  return `${assetType}|${normalizedName}`;
}

function createMatchItem(
  req: ExtractedRequirement,
  assets: MatchableAssets,
): AssetMatchItem {
  const candidates = assetsForKind(assets, req.assetType);
  const match = matchAssetByName(req.extractedName, candidates);
  return {
    id: `match_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    assetType: req.assetType,
    extractedName: req.extractedName,
    normalizedName: req.normalizedName,
    occurrences: req.occurrences,
    firstOffset: req.firstOffset,
    otherOffsets: req.otherOffsets,
    matchedAssetId: match.matchedAssetId,
    matchedAssetName: match.matchedAssetName,
    matchedAssetRevision: null,
    confidence: match.confidence,
    matchSource: "auto",
    resolution: match.resolution,
    locked: false,
    confirmed: false,
    revision: 1,
  };
}

function refreshAutoMatch(
  existing: AssetMatchItem,
  req: ExtractedRequirement,
  assets: MatchableAssets,
): AssetMatchItem {
  const candidates = assetsForKind(assets, req.assetType);
  const match = matchAssetByName(req.extractedName, candidates);
  return {
    ...existing,
    extractedName: req.extractedName,
    normalizedName: req.normalizedName,
    occurrences: req.occurrences,
    firstOffset: req.firstOffset,
    otherOffsets: req.otherOffsets,
    matchedAssetId: match.matchedAssetId,
    matchedAssetName: match.matchedAssetName,
    confidence: match.confidence,
    resolution: match.resolution,
    revision: existing.revision + 1,
  };
}

export type RunAutoMatchInput = {
  scriptText: string;
  assets: MatchableAssets;
  existingMatches: AssetMatchItem[];
};

/**
 * Extract script requirements and match against project assets.
 * Never auto-confirms; preserves locked and manual matches.
 */
export function runAutoMatch(input: RunAutoMatchInput): AssetMatchItem[] {
  const extracted = extractRequirements(input.scriptText);
  const existingByKey = new Map<string, AssetMatchItem>();
  for (const item of input.existingMatches) {
    existingByKey.set(requirementKey(item.assetType, item.normalizedName), item);
  }

  const result: AssetMatchItem[] = [];
  const consumedIds = new Set<string>();

  for (const req of extracted) {
    const key = requirementKey(req.assetType, req.normalizedName);
    const existing = existingByKey.get(key);
    if (existing) {
      consumedIds.add(existing.id);
      if (existing.locked || existing.matchSource === "manual") {
        result.push(existing);
      } else {
        result.push(refreshAutoMatch(existing, req, input.assets));
      }
      continue;
    }
    result.push(createMatchItem(req, input.assets));
  }

  for (const item of input.existingMatches) {
    if (!consumedIds.has(item.id)) {
      result.push(item);
    }
  }

  return result;
}
