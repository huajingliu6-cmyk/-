import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type {
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { libraryAssetIdForIdentity } from "@/projects/assets/extraction/identity";
import { mergeExtractedAssets } from "@/projects/assets/extraction/merge";
import {
  getActiveVersion,
  resultsForVersion,
} from "@/projects/assets/extraction/store";
import type {
  AssetExtractionStore,
  ExtractedAsset,
  ExtractedAssetDraft,
} from "@/projects/assets/extraction/types";
import type {
  AudioDesignDraft,
  CharacterDesignDraft,
  PropDesignDraft,
  SceneDesignDraft,
} from "@/projects/assets/episode-design/types";

function asCharacterDraft(draft: ExtractedAssetDraft): CharacterDesignDraft {
  return draft as CharacterDesignDraft;
}
function asSceneDraft(draft: ExtractedAssetDraft): SceneDesignDraft {
  return draft as SceneDesignDraft;
}
function asPropDraft(draft: ExtractedAssetDraft): PropDesignDraft {
  return draft as PropDesignDraft;
}
function asAudioDraft(draft: ExtractedAssetDraft): AudioDesignDraft {
  return draft as AudioDesignDraft;
}

function applyOverrides(
  assets: ExtractedAsset[],
  store: AssetExtractionStore,
  versionId: string,
): ExtractedAsset[] {
  const overrides = store.overrides.filter(
    (override) => override.versionId === versionId,
  );
  if (overrides.length === 0) return assets;
  return assets.map((asset) => {
    const override = overrides.find(
      (item) => item.assetIdentity === asset.identity,
    );
    if (!override) return asset;
    const fields = override.fields;
    return {
      ...asset,
      name:
        typeof fields.name === "string" && fields.name.trim()
          ? fields.name
          : asset.name,
      draft:
        fields.draft && typeof fields.draft === "object"
          ? (fields.draft as ExtractedAssetDraft)
          : asset.draft,
    };
  });
}

export function mergedAssetsForVersion(
  store: AssetExtractionStore,
  versionId: string,
): ExtractedAsset[] {
  const merged = mergeExtractedAssets(
    resultsForVersion(store, versionId).map((result) => result.assets),
  );
  return applyOverrides(merged, store, versionId);
}

export function mergedActiveAssets(store: AssetExtractionStore): ExtractedAsset[] {
  const active = getActiveVersion(store);
  if (!active) return [];
  return mergedAssetsForVersion(store, active.id);
}

function findExistingByIdentity<T extends { id: string; name: string }>(
  previous: T[] | undefined,
  identityId: string,
  name: string,
): T | undefined {
  return (
    previous?.find((item) => item.id === identityId) ??
    previous?.find((item) => item.name.trim() === name.trim())
  );
}

function sortByFirstSeen<T extends { firstSeenOrder?: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.firstSeenOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.firstSeenOrder ?? Number.MAX_SAFE_INTEGER),
  );
}

export function extractedAssetsToBundle(
  projectId: string,
  assets: ExtractedAsset[],
  previous?: ProjectAssetBundle | null,
): ProjectAssetBundle {
  const characters: CharacterAsset[] = [];
  const scenes: SceneAsset[] = [];
  const props: PropAsset[] = [];
  const audios: AudioAsset[] = [];

  for (const asset of sortByFirstSeen(assets)) {
    const id = asset.libraryAssetId?.trim() || libraryAssetIdForIdentity(asset.identity);
    if (asset.assetType === "character") {
      const draft = asCharacterDraft(asset.draft);
      const prev = findExistingByIdentity(previous?.characters, id, asset.name);
      characters.push({
        id: prev?.id ?? id,
        projectId,
        name: asset.name,
        role: draft.role ?? "",
        description: draft.description ?? "",
        appearance: draft.appearance ?? "",
        clothing: draft.clothing ?? "",
        age: draft.age ?? "",
        gender: prev?.gender ?? "",
        voiceId: draft.voiceId ?? prev?.voiceId ?? null,
        voiceName: draft.voiceName ?? prev?.voiceName ?? null,
        voiceStyle: prev?.voiceStyle ?? null,
        imageFileName: prev?.imageFileName ?? null,
        imageObjectUrl: prev?.imageObjectUrl ?? null,
        imageMimeType: prev?.imageMimeType ?? null,
        status: prev?.status ?? "draft",
        approvedMediaIds: prev?.approvedMediaIds,
        primaryMediaId: prev?.primaryMediaId,
        historyMediaIds: prev?.historyMediaIds,
        lookMediaIds: prev?.lookMediaIds,
        mediaVoices: prev?.mediaVoices,
        mediaVideoRefSafety: prev?.mediaVideoRefSafety,
        videoRefSafety: prev?.videoRefSafety,
        mediaDisplayNames: prev?.mediaDisplayNames,
        mediaLastUsedAt: prev?.mediaLastUsedAt,
        mediaLookProvenance: prev?.mediaLookProvenance,
        approvalProvenance: prev?.approvalProvenance,
      });
    } else if (asset.assetType === "scene") {
      const draft = asSceneDraft(asset.draft);
      const prev = findExistingByIdentity(previous?.scenes, id, asset.name);
      scenes.push({
        id: prev?.id ?? id,
        projectId,
        name: asset.name,
        sceneType: prev?.sceneType ?? "",
        description: draft.description ?? "",
        timeOfDay: draft.timeOfDay ?? "",
        location: draft.location ?? "",
        style: draft.style ?? "",
        imageFileName: prev?.imageFileName ?? null,
        imageObjectUrl: prev?.imageObjectUrl ?? null,
        imageMimeType: prev?.imageMimeType ?? null,
        status: prev?.status ?? "draft",
        approvedMediaIds: prev?.approvedMediaIds,
        primaryMediaId: prev?.primaryMediaId,
        approvalProvenance: prev?.approvalProvenance,
        videoRefSafety: prev?.videoRefSafety,
      });
    } else if (asset.assetType === "prop") {
      const draft = asPropDraft(asset.draft);
      const prev = findExistingByIdentity(previous?.props, id, asset.name);
      props.push({
        id: prev?.id ?? id,
        projectId,
        name: asset.name,
        propType: draft.propType ?? "",
        usage: draft.usage ?? "",
        description: draft.description ?? "",
        imageFileName: prev?.imageFileName ?? null,
        imageObjectUrl: prev?.imageObjectUrl ?? null,
        imageMimeType: prev?.imageMimeType ?? null,
        status: prev?.status ?? "draft",
        approvedMediaIds: prev?.approvedMediaIds,
        primaryMediaId: prev?.primaryMediaId,
        approvalProvenance: prev?.approvalProvenance,
        videoRefSafety: prev?.videoRefSafety,
      });
    } else {
      const draft = asAudioDraft(asset.draft);
      const prev = findExistingByIdentity(previous?.audios, id, asset.name);
      audios.push({
        id: prev?.id ?? id,
        projectId,
        name: asset.name,
        type: draft.audioKind ?? prev?.type ?? "sfx",
        duration: draft.duration ?? prev?.duration ?? "",
        source: draft.source ?? prev?.source ?? "",
        fileName: prev?.fileName ?? null,
        objectUrl: prev?.objectUrl ?? null,
        mimeType: prev?.mimeType ?? null,
        status: prev?.status ?? "draft",
      });
    }
  }

  return { projectId, characters, scenes, props, audios };
}

export async function materializeActiveVersionToBundle(
  projectId: string,
  store: AssetExtractionStore,
): Promise<ProjectAssetBundle> {
  const previous = await loadAssetBundleDraft(projectId);
  const assets = mergedActiveAssets(store);
  const bundle = extractedAssetsToBundle(projectId, assets, previous);
  return saveAssetBundleDraft(bundle);
}
