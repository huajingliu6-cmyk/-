import type { CharacterAsset } from "@/projects/assets/types";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import type {
  StoryboardPromptCharacterContext,
  StoryboardPromptContext,
} from "@/projects/storyboard/services/storyboard-prompt-llm";
import type { StoryboardShot } from "@/projects/storyboard/types";
import { stripScriptMetaForStoryboard } from "@/projects/storyboard/services/storyboard-prompt-content-policy";
import { buildProjectVisualStyleDirective } from "@/projects/project-visual-style";

export type { StoryboardPromptCharacterContext };

function mapCharacterAsset(
  character: CharacterAsset,
  selectedMediaId?: string | null,
): StoryboardPromptCharacterContext {
  return {
    assetId: character.id,
    name: character.name,
    role: character.role?.trim() || undefined,
    appearance: character.appearance?.trim() || undefined,
    clothing: character.clothing?.trim() || undefined,
    age: character.age?.trim() || undefined,
    gender: character.gender?.trim() || undefined,
    description: character.description?.trim() || undefined,
    primaryMediaId: character.primaryMediaId ?? null,
    selectedMediaId:
      selectedMediaId ??
      character.primaryMediaId ??
      character.approvedMediaIds?.[0] ??
      null,
  };
}

function characterById(
  assets: MatchableAssets | null | undefined,
): Map<string, CharacterAsset> {
  const map = new Map<string, CharacterAsset>();
  for (const character of assets?.characters ?? []) {
    map.set(character.id, character);
  }
  return map;
}

/** Resolve per-shot character bindings for LLM prompts. */
export function resolveShotCharacterContexts(
  shot: StoryboardShot,
  assets?: MatchableAssets | null,
): StoryboardPromptCharacterContext[] {
  const byId = characterById(assets);
  const orderedIds = [
    ...(shot.characterAssetIds ?? []),
    ...(shot.requirements ?? [])
      .filter((item) => item.type === "character" && item.selectedAssetId)
      .map((item) => item.selectedAssetId as string),
  ];
  const seen = new Set<string>();
  const contexts: StoryboardPromptCharacterContext[] = [];
  for (const assetId of orderedIds) {
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    const character = byId.get(assetId);
    if (!character) continue;
    const selectedMediaId = shot.assetMediaIds?.[assetId] ?? null;
    contexts.push(mapCharacterAsset(character, selectedMediaId));
  }

  for (const name of shot.requiredCharacters) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const matched = assets?.characters.find((item) => item.name === trimmed);
    if (!matched || seen.has(matched.id)) continue;
    seen.add(matched.id);
    contexts.push(
      mapCharacterAsset(matched, shot.assetMediaIds?.[matched.id] ?? null),
    );
  }

  return contexts;
}

/** Build LLM context from confirmed script + project library for task-rule prompts. */
export function buildStoryboardPromptContext(input: {
  scriptText?: string | null;
  libraryAssets?: MatchableAssets | null;
  aspectRatio?: string;
  /** Explicit project visual style id (server-side only). */
  visualStyle?: string | null;
  /** Project highlights (server-side only). */
  highlights?: string | null;
  /** Pre-built directive; if omitted, built from visualStyle/highlights. */
  visualStyleDirective?: string | null;
}): StoryboardPromptContext {
  const assets = input.libraryAssets;
  const visualStyleDirective =
    input.visualStyleDirective?.trim() ||
    buildProjectVisualStyleDirective({
      visualStyle: input.visualStyle,
      highlights: input.highlights,
    }) ||
    undefined;

  return {
    scriptText: stripScriptMetaForStoryboard(input.scriptText?.trim() || ""),
    aspectRatio: input.aspectRatio?.trim() || "9:16",
    characters:
      assets?.characters.map((character) => mapCharacterAsset(character)) ??
      [],
    scenes:
      assets?.scenes.map((s) => ({
        name: s.name,
        location: s.location,
      })) ?? [],
    props: assets?.props.map((p) => ({ name: p.name })) ?? [],
    audios: assets?.audios.map((a) => ({ name: a.name })) ?? [],
    ...(visualStyleDirective ? { visualStyleDirective } : {}),
  };
}

export function formatCharacterContextLines(
  characters: StoryboardPromptCharacterContext[],
): string[] {
  if (characters.length === 0) {
    return ["本镜绑定人物：无（空镜/环境镜可不写人物站位）"];
  }
  return [
    "本镜绑定人物（assetId 仅供服务端匹配，禁止写入任何输出字段；挂载行由服务端生成）：",
    ...characters.map((character) =>
      [
        `- ${character.name}`,
        character.role ? `  角色定位: ${character.role}` : null,
        character.age ? `  年龄: ${character.age}` : null,
        character.gender ? `  性别: ${character.gender}` : null,
        character.appearance ? `  外貌: ${character.appearance}` : null,
        character.clothing ? `  服装: ${character.clothing}` : null,
        character.description ? `  描述: ${character.description}` : null,
        `  （内部）assetId=${character.assetId} — 禁止输出`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ];
}
