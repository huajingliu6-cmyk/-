import { recoverJsonObjectText } from "@/projects/assets/episode-design/json-text-repair";
import { extractRawAssetList } from "@/projects/assets/episode-design/normalize-raw-asset";
import type { ScriptAssetChunk } from "@/projects/assets/episode-design/script-asset-chunks";
import { assetIdentity } from "@/projects/assets/extraction/identity";
import type { AssetRosterItem } from "@/projects/assets/extraction/types";
import type { EpisodeAssetDesignAssetType } from "@/projects/assets/episode-design/types";
import { normalizeAssetName } from "@/projects/storyboard/hash";

const TYPE_ALIASES: Record<string, EpisodeAssetDesignAssetType> = {
  character: "character",
  char: "character",
  person: "character",
  人物: "character",
  角色: "character",
  scene: "scene",
  set: "scene",
  location: "scene",
  场景: "scene",
  地点: "scene",
  prop: "prop",
  item: "prop",
  道具: "prop",
  物品: "prop",
  audio: "audio",
  sound: "audio",
  music: "audio",
  sfx: "audio",
  音频: "audio",
  音乐: "audio",
  音效: "audio",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

const ROSTER_FORBIDDEN_DETAIL_KEYS = [
  "design",
  "description",
  "appearance",
  "clothing",
  "location",
  "style",
  "usageInEpisode",
  "prompt",
  "propType",
  "audioKind",
] as const;

function stripForbiddenRosterDetailFields(obj: Record<string, unknown>): void {
  for (const key of ROSTER_FORBIDDEN_DETAIL_KEYS) {
    delete obj[key];
  }
}

const PLACEHOLDER_EPISODE_ID = /^episode_\d+$/i;

/** Prefer real script episode ids from chunk context over model placeholders. */
export function normalizeRosterEpisodeIds(
  modelEpisodeIds: string[],
  chunkEpisodeIds: string[],
): string[] {
  const chunkSet = new Set(chunkEpisodeIds.filter(Boolean));
  const validFromModel = modelEpisodeIds.filter((id) => chunkSet.has(id));
  if (validFromModel.length > 0) {
    return [...new Set([...validFromModel, ...chunkEpisodeIds])];
  }
  if (chunkEpisodeIds.length > 0) {
    return [...chunkEpisodeIds];
  }
  return [...new Set(modelEpisodeIds.filter(Boolean))];
}

export function normalizeExtractedEpisodeIds(
  assetEpisodeIds: string[],
  knownEpisodeIds: string[],
): string[] {
  const known = new Set(knownEpisodeIds.filter(Boolean));
  const valid = assetEpisodeIds.filter((id) => known.has(id));
  if (valid.length > 0) return [...new Set(valid)];
  if (knownEpisodeIds.length === 1) {
    return [knownEpisodeIds[0]!];
  }
  const placeholders = assetEpisodeIds.filter((id) =>
    PLACEHOLDER_EPISODE_ID.test(id),
  );
  if (placeholders.length > 0 && knownEpisodeIds.length > 0) {
    return [knownEpisodeIds[0]!];
  }
  return assetEpisodeIds;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[,，;；/|]/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [];
  }
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function resolveType(value: unknown): EpisodeAssetDesignAssetType | null {
  if (typeof value !== "string") return null;
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? TYPE_ALIASES[value.trim()] ?? null;
}

export function scriptAssetChunkBody(chunk: ScriptAssetChunk): string {
  if (chunk.body?.trim()) return chunk.body;
  const tagged =
    /<剧本分块>\n?([\s\S]*?)\n?<\/剧本分块>/.exec(chunk.brief) ??
    /<完整剧本>\n?([\s\S]*?)\n?<\/完整剧本>/.exec(chunk.brief);
  return tagged?.[1]?.trim() ?? chunk.brief;
}

export function parseRosterOutput(
  text: string,
  chunkEpisodeIds: string[] = [],
  orderBase = 0,
): { ok: true; items: AssetRosterItem[] } | { ok: false; error: string } {
  const recovered = recoverJsonObjectText(text);
  if (!recovered) {
    return { ok: false, error: "资产名单 JSON 无效" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(recovered.text) as unknown;
  } catch {
    return { ok: false, error: "资产名单 JSON 无效" };
  }
  const list = extractRawAssetList(parsed);
  if (!list) {
    return { ok: false, error: "资产名单缺少列表" };
  }
  const items: AssetRosterItem[] = [];
  for (const raw of list) {
    const obj = asRecord(raw);
    if (!obj) continue;
    const type =
      resolveType(obj.type) ??
      resolveType(obj.assetType) ??
      resolveType(obj.kind);
    const name = pickString(obj, ["name", "title", "label", "名称", "assetName"]);
    if (!type || !name) continue;
    stripForbiddenRosterDetailFields(obj);
    const aliases = pickStringArray(obj.aliases ?? obj.alias ?? obj.aka);
    const evidenceRefs = pickStringArray(
      obj.evidenceRefs ?? obj.evidence ?? obj.evidences ?? obj.script_evidence,
    );
    const episodeIds = normalizeRosterEpisodeIds(
      pickStringArray(obj.episodeIds),
      chunkEpisodeIds,
    );
    items.push({
      assetKey:
        pickString(obj, ["assetKey", "asset_key"]) || assetIdentity(type, name),
      type,
      name,
      aliases,
      episodeIds,
      evidenceRefs,
      firstSeenOrder: orderBase + items.length,
    });
  }
  return { ok: true, items };
}

export function mergeRosterItems(items: AssetRosterItem[]): AssetRosterItem[] {
  const byKey = new Map<string, AssetRosterItem>();
  const aliasToKey = new Map<string, string>();

  const aliasKey = (type: EpisodeAssetDesignAssetType, name: string) =>
    `${type}:${normalizeAssetName(name)}`;

  const canonicalKeyFor = (item: AssetRosterItem): string => {
    const self = aliasKey(item.type, item.name);
    const existing = aliasToKey.get(self);
    if (existing) return existing;
    for (const alias of item.aliases) {
      const hit = aliasToKey.get(aliasKey(item.type, alias));
      if (hit) return hit;
    }
    return item.assetKey || self;
  };

  for (const item of items) {
    const key = canonicalKeyFor(item);
    const current: AssetRosterItem = {
      ...item,
      assetKey: key,
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        ...current,
        aliases: [...new Set(current.aliases)],
        episodeIds: [...new Set(current.episodeIds)],
        evidenceRefs: [...new Set(current.evidenceRefs)],
      });
    } else {
      byKey.set(key, {
        ...prev,
        name: prev.name.length >= current.name.length ? prev.name : current.name,
        firstSeenOrder: Math.min(
          prev.firstSeenOrder ?? Number.MAX_SAFE_INTEGER,
          current.firstSeenOrder ?? Number.MAX_SAFE_INTEGER,
        ),
        aliases: [
          ...new Set([
            ...prev.aliases,
            ...current.aliases,
            current.name !== prev.name ? current.name : "",
          ]),
        ].filter(Boolean),
        episodeIds: [...new Set([...prev.episodeIds, ...current.episodeIds])],
        evidenceRefs: [
          ...new Set([...prev.evidenceRefs, ...current.evidenceRefs]),
        ],
      });
    }
    const stored = byKey.get(key)!;
    aliasToKey.set(aliasKey(stored.type, stored.name), key);
    for (const alias of stored.aliases) {
      aliasToKey.set(aliasKey(stored.type, alias), key);
    }
  }

  return [...byKey.values()]
    .sort(
      (a, b) =>
        (a.firstSeenOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.firstSeenOrder ?? Number.MAX_SAFE_INTEGER),
    )
    .map((item) => ({
    ...item,
    assetKey: item.assetKey || assetIdentity(item.type, item.name),
    aliases: item.aliases.filter(
      (alias) => normalizeAssetName(alias) !== normalizeAssetName(item.name),
    ),
  }));
}
