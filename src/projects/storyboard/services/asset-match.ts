import { randomUUID } from "crypto";
import type {
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { normalizeAssetName } from "@/projects/storyboard/hash";
import {
  buildRequirementsFromNames,
  ensureShotRequirements,
} from "@/projects/storyboard/shot-completeness";
import type {
  AssetKind,
  AssetMatchItem,
  MatchConfidence,
  MatchResolution,
  ShotAssetRequirement,
  StoryboardShot,
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

/** Field labels / section headers that must never be treated as character names. */
export const CHARACTER_LABEL_STOP_WORDS = new Set([
  "人物",
  "角色",
  "演员",
  "出场人物",
  "主要人物",
  "场景",
  "地点",
  "时间",
  "道具",
  "音效",
  "音乐",
  "对白",
  "台词",
  "动作",
  "画面",
  "镜头",
  "旁白",
  "备注",
  "INT",
  "EXT",
  "内景",
  "外景",
]);

const EMPTY_CHARACTER_TOKENS = new Set([
  "无",
  "无人物",
  "暂无",
  "暂无人物",
  "没有",
  "无。",
  "-",
  "—",
  "无角色",
]);

function isUsableName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= MIN_NAME_LEN &&
    trimmed.length <= MAX_NAME_LEN &&
    !/^[，,。！？\s\d]+$/.test(trimmed)
  );
}

/** Strip parenthetical notes: 韩兆丰（男，55岁） → 韩兆丰 */
export function stripCharacterNameAnnotations(name: string): string {
  return name
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/【[^】]*】/g, "")
    .trim();
}

export function isUsableCharacterName(name: string): boolean {
  const normalized = stripCharacterNameAnnotations(name).trim();
  if (!isUsableName(normalized)) return false;
  if (CHARACTER_LABEL_STOP_WORDS.has(normalized)) return false;
  if (EMPTY_CHARACTER_TOKENS.has(normalized)) return false;
  if (/^(场景|道具|音效|音乐|INT|EXT|内景|外景)$/i.test(normalized)) {
    return false;
  }
  return true;
}

function mergeRequirement(
  map: Map<string, ExtractedRequirement>,
  assetType: AssetKind,
  rawName: string,
  offset: number,
) {
  const cleaned =
    assetType === "character"
      ? stripCharacterNameAnnotations(rawName)
      : rawName.trim();
  const extractedName = cleaned.trim();
  if (assetType === "character") {
    if (!isUsableCharacterName(extractedName)) return;
  } else if (!isUsableName(extractedName)) {
    return;
  }
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

/** Split "韩兆丰、范德维奇" / "韩兆丰和范德维奇" style lists. */
export function splitCharacterNameList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || EMPTY_CHARACTER_TOKENS.has(trimmed)) return [];
  // Strip notes first so commas inside （男，55岁） do not split names.
  const withoutNotes = stripCharacterNameAnnotations(trimmed);
  if (!withoutNotes || EMPTY_CHARACTER_TOKENS.has(withoutNotes)) return [];
  return withoutNotes
    .split(/[、,，/｜|]/)
    .flatMap((part) => part.split(/(?:和|与)/))
    .map((part) => part.trim())
    .filter((part) => isUsableCharacterName(part));
}

/**
 * Explicit roster lines: 人物：韩兆丰、范德维奇
 * Never treats the label itself as a character name.
 */
function extractCharacterRosterLines(
  scriptText: string,
  map: Map<string, ExtractedRequirement>,
) {
  const re = /^(?:[\s　]*)(?:人物|角色|出场人物|主要人物)[：:]\s*([^\n]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scriptText)) !== null) {
    const listOffset = match.index + match[0].indexOf(match[1] ?? "");
    for (const name of splitCharacterNameList(match[1] ?? "")) {
      mergeRequirement(map, "character", name, listOffset);
    }
  }
}

/**
 * Speaker lines only: line-start 「姓名：台词」 / 「姓名（动作）：台词」.
 * Does not match mid-paragraph field labels like 「人物：…」.
 */
function extractSpeakerLines(
  scriptText: string,
  map: Map<string, ExtractedRequirement>,
) {
  const re =
    /^(?:[\s　]*)([^\s，,。！？「」:：\n]{2,12})(?:（[^）]*）|\([^)]*\))?[：:]\s*\S+/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(scriptText)) !== null) {
    const speaker = match[1] ?? "";
    if (!isUsableCharacterName(speaker)) continue;
    mergeRequirement(map, "character", speaker, match.index);
  }
}

/** Conservative regex heuristics for confirmed Chinese script text. */
export function extractRequirements(scriptText: string): ExtractedRequirement[] {
  const map = new Map<string, ExtractedRequirement>();
  if (!scriptText.trim()) return [];

  extractCharacterRosterLines(scriptText, map);
  extractSpeakerLines(scriptText, map);

  extractWithPattern(
    scriptText,
    map,
    "character",
    /([^\s，,。！？「」\n]{2,12})(?:说|道)[：:]/g,
  );
  extractWithPattern(
    scriptText,
    map,
    "character",
    /([^\s，,。！？「」\n]{2,12})进入画面/g,
  );
  extractWithPattern(
    scriptText,
    map,
    "character",
    /([^\s，,。！？「」\n]{2,12})望向/g,
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
    "scene",
    /(?:INT|EXT|内景|外景)[\s/·\-—]*([^\n，,。！？]{2,30})/gi,
  );
  extractWithPattern(scriptText, map, "scene", /场景[：:]\s*([^\n，,。！？]{2,30})/g);
  extractWithPattern(scriptText, map, "prop", /道具[：:]\s*([^\n，,。！？]{2,20})/g);
  extractWithPattern(scriptText, map, "audio", /音效[：:]\s*([^\n，,。！？]{2,20})/g);
  extractWithPattern(scriptText, map, "audio", /音乐[：:]\s*([^\n，,。！？]{2,20})/g);

  return [...map.values()].sort((a, b) => a.firstOffset - b.firstOffset);
}

/** Extract character names from a shot snippet or dialogue block. */
export function extractCharacterNamesFromText(text: string): string[] {
  const names = new Set<string>();
  if (!text.trim()) return [];

  const rosterRe =
    /^(?:[\s　]*)(?:人物|角色|出场人物|主要人物)[：:]\s*([^\n]*)/gm;
  let rosterMatch: RegExpExecArray | null;
  while ((rosterMatch = rosterRe.exec(text)) !== null) {
    for (const name of splitCharacterNameList(rosterMatch[1] ?? "")) {
      names.add(name);
    }
  }

  const speakerRe =
    /^(?:[\s　]*)([^\s，,。！？「」:：\n]{2,12})(?:（[^）]*）|\([^)]*\))?[：:]\s*\S+/gm;
  let speakerMatch: RegExpExecArray | null;
  while ((speakerMatch = speakerRe.exec(text)) !== null) {
    const speaker = stripCharacterNameAnnotations(speakerMatch[1] ?? "").trim();
    if (isUsableCharacterName(speaker)) names.add(speaker);
  }

  const patterns = [
    /([^\s，,。！？「」\n]{2,12})(?:说|道)[：:]/g,
    /([^\s，,。！？「」\n]{2,12})进入画面/g,
    /([^\s，,。！？「」\n]{2,12})望向/g,
    /([^\s，,。！？「」]{2,12})出场/g,
    /[\u4e00-\u9fff]{2,4}(?=出场|走来|说道|说：「|望向)/g,
  ];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const name = stripCharacterNameAnnotations(
        (match[1] ?? match[0])?.trim() ?? "",
      ).trim();
      if (isUsableCharacterName(name)) names.add(name);
    }
  }
  return [...names];
}

/**
 * Drop label-like dirty character requirements from an existing shot
 * (e.g. requiredCharacters: ["人物"]) and re-scan shot text for real names.
 */
export function sanitizeShotCharacterRequirements(
  shot: StoryboardShot,
): StoryboardShot {
  const textBlob = [
    shot.visualDescription,
    shot.actionDescription,
    shot.dialogue,
    shot.shotSummary,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n");

  const fromExisting = (shot.requiredCharacters ?? [])
    .map((name) => stripCharacterNameAnnotations(name).trim())
    .filter((name) => isUsableCharacterName(name));
  const fromText = extractCharacterNamesFromText(textBlob);
  const requiredCharacters = [...new Set([...fromExisting, ...fromText])];

  const previousRequirements = ensureShotRequirements(shot);
  const keptNonCharacter = previousRequirements.filter(
    (req) => req.type !== "character",
  );
  const keptGoodCharacter = previousRequirements.filter(
    (req) =>
      req.type === "character" && isUsableCharacterName(req.sourceName),
  );

  const keptNames = new Set(
    keptGoodCharacter.map((req) => req.sourceName.trim()),
  );
  const missingNames = requiredCharacters.filter((name) => !keptNames.has(name));
  const addedCharacterReqs: ShotAssetRequirement[] =
    missingNames.length > 0
      ? buildRequirementsFromNames({
          characters: missingNames,
          props: [],
          scene: null,
          stableIds: true,
        })
      : [];

  const removedBadCharacterReqs = previousRequirements.filter(
    (req) =>
      req.type === "character" && !isUsableCharacterName(req.sourceName),
  );
  const removedAssetIds = new Set(
    removedBadCharacterReqs
      .map((req) => req.selectedAssetId?.trim())
      .filter((id): id is string => Boolean(id)),
  );

  const stillLinkedIds = new Set(
    keptGoodCharacter
      .filter((req) => req.resolution === "LINKED" && req.selectedAssetId)
      .map((req) => req.selectedAssetId!),
  );

  const characterAssetIds = (shot.characterAssetIds ?? []).filter((id) => {
    if (removedAssetIds.has(id) && !stillLinkedIds.has(id)) return false;
    return true;
  });

  const nextRequirements = [
    ...keptNonCharacter,
    ...keptGoodCharacter,
    ...addedCharacterReqs,
  ];

  const sameCharacters =
    requiredCharacters.length === (shot.requiredCharacters?.length ?? 0) &&
    requiredCharacters.every((name) =>
      (shot.requiredCharacters ?? []).includes(name),
    );
  const sameAssetIds =
    characterAssetIds.length === (shot.characterAssetIds?.length ?? 0) &&
    characterAssetIds.every((id) => shot.characterAssetIds.includes(id));
  const sameRequirements =
    nextRequirements.length === previousRequirements.length &&
    nextRequirements.every((req, i) => {
      const old = previousRequirements[i];
      return (
        old &&
        old.requirementId === req.requirementId &&
        old.sourceName === req.sourceName &&
        old.selectedAssetId === req.selectedAssetId &&
        old.resolution === req.resolution
      );
    });

  if (sameCharacters && sameAssetIds && sameRequirements) {
    return shot;
  }

  return {
    ...shot,
    requiredCharacters,
    characterAssetIds,
    requirements: nextRequirements,
  };
}

/** Drop auto-extracted character matches that are field labels, not names. */
export function sanitizeAssetMatchItems(
  matches: AssetMatchItem[],
): AssetMatchItem[] {
  return matches.filter((item) => {
    if (item.assetType !== "character") return true;
    return isUsableCharacterName(item.extractedName);
  });
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
  const existingMatches = sanitizeAssetMatchItems(input.existingMatches);
  const existingByKey = new Map<string, AssetMatchItem>();
  for (const item of existingMatches) {
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

  for (const item of existingMatches) {
    if (!consumedIds.has(item.id)) {
      result.push(item);
    }
  }

  return result;
}
