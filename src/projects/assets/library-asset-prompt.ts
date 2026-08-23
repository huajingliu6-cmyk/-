import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import type {
  CharacterDesignItem,
  EpisodeAssetDesignItem,
  PropDesignItem,
  SceneDesignItem,
} from "@/projects/assets/episode-design/types";

export type LibraryPromptAsset = CharacterAsset | SceneAsset | PropAsset;
export type LibraryPromptAssetKind = "character" | "scene" | "prop";

export function findLibraryDesignItem(
  asset: LibraryPromptAsset | null,
  items: EpisodeAssetDesignItem[] | undefined,
): EpisodeAssetDesignItem | null {
  if (!asset || !items?.length) return null;
  const provenance = asset.approvalProvenance;
  // Match by stable ids only — name fallback can bind the wrong episode item
  // when switching characters in the library (prompt/image desync).
  return (
    items.find(
      (item) =>
        item.assetType !== "audio" &&
        (item.id === provenance?.assetDesignItemId ||
          item.libraryAssetId === asset.id ||
          item.existingAssetId === asset.id),
    ) ?? null
  );
}

function mediaState(asset: LibraryPromptAsset) {
  const historyIds = [
    ...(asset.approvedMediaIds ?? []),
    ...(asset.primaryMediaId ? [asset.primaryMediaId] : []),
  ].filter((id, index, list) => id && list.indexOf(id) === index);
  if (historyIds.length === 0) return undefined;
  const currentId = asset.primaryMediaId ?? historyIds[historyIds.length - 1] ?? null;
  return {
    currentId,
    historyIds,
    status: "completed" as const,
    promptFingerprint: null,
    errorMessage: null,
  };
}

function fallbackPrompt(asset: LibraryPromptAsset, kind: LibraryPromptAssetKind): string {
  if (kind === "character") {
    const character = asset as CharacterAsset;
    return [
      `角色：${character.name}`,
      character.role && `定位：${character.role}`,
      character.appearance && `外观：${character.appearance}`,
      character.clothing && `服装：${character.clothing}`,
      character.age && `年龄：${character.age}`,
      character.description && `补充：${character.description}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "scene") {
    const scene = asset as SceneAsset;
    return [
      `场景：${scene.name}`,
      scene.sceneType && `类型：${scene.sceneType}`,
      scene.location && `位置：${scene.location}`,
      scene.timeOfDay && `时间：${scene.timeOfDay}`,
      scene.style && `风格：${scene.style}`,
      scene.description && `补充：${scene.description}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const prop = asset as PropAsset;
  return [
    `道具：${prop.name}`,
    prop.propType && `类型：${prop.propType}`,
    prop.usage && `用途：${prop.usage}`,
    prop.description && `补充：${prop.description}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function makeLibraryDesignItem(
  asset: LibraryPromptAsset,
  kind: LibraryPromptAssetKind,
  sourceItem?: EpisodeAssetDesignItem | null,
): EpisodeAssetDesignItem {
  const sourcePrompt = sourceItem?.designPrompt?.text?.trim() ?? "";
  const prompt = sourcePrompt || fallbackPrompt(asset, kind);
  const designPrompt = {
    status: "ready" as const,
    text: prompt,
    generationId: sourceItem?.designPrompt?.generationId ?? null,
    sourceFingerprint: sourceItem?.designPrompt?.sourceFingerprint ?? null,
    generatedAt: sourceItem?.designPrompt?.generatedAt ?? null,
    updatedAt: sourceItem?.designPrompt?.updatedAt ?? null,
    errorMessage: sourceItem?.designPrompt?.errorMessage ?? null,
    history: sourceItem?.designPrompt?.history ?? [],
  };
  const generatedMedia = sourceItem?.generatedMedia ?? mediaState(asset);

  if (sourceItem && sourceItem.assetType === kind) {
    return {
      ...sourceItem,
      name: asset.name || sourceItem.name,
      libraryAssetId: sourceItem.libraryAssetId ?? asset.id,
      designPrompt,
      ...(generatedMedia ? { generatedMedia } : {}),
    } as EpisodeAssetDesignItem;
  }

  const common = {
    id: sourceItem?.id ?? `library-${kind}-${asset.id}`,
    name: asset.name,
    resolution: "link_existing" as const,
    existingAssetId: asset.id,
    libraryAssetId: asset.id,
    source: "manual" as const,
    designPrompt,
    ...(generatedMedia ? { generatedMedia } : {}),
  };

  if (kind === "character") {
    const character = asset as CharacterAsset;
    const item: CharacterDesignItem = {
      ...common,
      assetType: "character",
      draft: {
        description: character.description,
        appearance: character.appearance,
        clothing: character.clothing,
        role: character.role,
        age: character.age,
        voiceId: character.voiceId,
        voiceName: character.voiceName,
        voiceBound: Boolean(character.voiceId),
        usageInEpisode: "",
        evidence: "",
      },
    };
    return item;
  }
  if (kind === "scene") {
    const scene = asset as SceneAsset;
    const item: SceneDesignItem = {
      ...common,
      assetType: "scene",
      draft: {
        description: scene.description,
        timeOfDay: scene.timeOfDay,
        location: scene.location,
        style: scene.style,
        usageInEpisode: "",
        evidence: "",
      },
    };
    return item;
  }
  const prop = asset as PropAsset;
  const item: PropDesignItem = {
    ...common,
    assetType: "prop",
    draft: {
      description: prop.description,
      propType: prop.propType,
      usage: prop.usage,
      usageInEpisode: "",
      evidence: "",
    },
  };
  return item;
}
