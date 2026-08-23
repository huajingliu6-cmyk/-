import type { ProjectAssetBundle } from "@/projects/assets/types";
import { assetIdentity, originalAiFingerprint } from "@/projects/assets/extraction/identity";
import { mergeExtractedAssets } from "@/projects/assets/extraction/merge";
import {
  getActiveVersion,
  mutateAssetExtractionStore,
  resultsForVersion,
} from "@/projects/assets/extraction/store";
import type {
  AssetManualOverride,
  ExtractedAssetDraft,
} from "@/projects/assets/extraction/types";

function bundleDraftForAsset(
  bundle: ProjectAssetBundle,
  identity: string,
): { name: string; draft: ExtractedAssetDraft } | null {
  const [assetType] = identity.split(":");
  if (assetType === "character") {
    const asset = bundle.characters.find(
      (item) => assetIdentity("character", item.name) === identity,
    );
    if (!asset) return null;
    return {
      name: asset.name,
      draft: {
        description: asset.description,
        appearance: asset.appearance,
        clothing: asset.clothing,
        role: asset.role,
        age: asset.age,
        voiceId: asset.voiceId,
        voiceName: asset.voiceName,
        voiceBound: Boolean(asset.voiceId),
        usageInEpisode: "",
        evidence: "",
      },
    };
  }
  if (assetType === "scene") {
    const asset = bundle.scenes.find(
      (item) => assetIdentity("scene", item.name) === identity,
    );
    if (!asset) return null;
    return {
      name: asset.name,
      draft: {
        description: asset.description,
        timeOfDay: asset.timeOfDay,
        location: asset.location,
        style: asset.style,
        usageInEpisode: "",
        evidence: "",
      },
    };
  }
  if (assetType === "prop") {
    const asset = bundle.props.find(
      (item) => assetIdentity("prop", item.name) === identity,
    );
    if (!asset) return null;
    return {
      name: asset.name,
      draft: {
        description: asset.description,
        propType: asset.propType,
        usage: asset.usage,
        usageInEpisode: "",
        evidence: "",
      },
    };
  }
  const asset = bundle.audios.find(
    (item) => assetIdentity("audio", item.name) === identity,
  );
  if (!asset) return null;
  return {
    name: asset.name,
    draft: {
      description: "",
      audioKind: asset.type,
      duration: asset.duration,
      source: asset.source,
      usageInEpisode: "",
      evidence: "",
    },
  };
}

export async function syncManualOverridesFromBundle(
  projectId: string,
  bundle: ProjectAssetBundle,
): Promise<void> {
  await mutateAssetExtractionStore(projectId, (store) => {
    const active = getActiveVersion(store);
    if (!active) return store;
    const originals = mergeExtractedAssets(
      resultsForVersion(store, active.id).map((result) => result.assets),
    );
    const now = new Date().toISOString();
    const nextOverrides: AssetManualOverride[] = [];
    for (const original of originals) {
      const current = bundleDraftForAsset(bundle, original.identity);
      if (!current) continue;
      const fingerprint = originalAiFingerprint(current.draft);
      if (fingerprint === original.originalAiFingerprint) continue;
      nextOverrides.push({
        projectId,
        versionId: active.id,
        assetIdentity: original.identity,
        fields: { name: current.name, draft: current.draft },
        originalAiFingerprint: original.originalAiFingerprint,
        updatedAt: now,
      });
    }
    return {
      ...store,
      overrides: [
        ...store.overrides.filter((override) => override.versionId !== active.id),
        ...nextOverrides,
      ],
    };
  });
}
