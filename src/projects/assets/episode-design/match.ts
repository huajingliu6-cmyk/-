import { normalizeAssetName } from "@/projects/storyboard/hash";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import type {
  AssetDesignResolution,
  EpisodeAssetDesignAssetType,
  EpisodeAssetDesignItem,
} from "@/projects/assets/episode-design/types";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";

type MatchableBundle = Pick<
  ProjectAssetBundle,
  "characters" | "scenes" | "props" | "audios"
>;

function listAssetsByType(
  bundle: MatchableBundle,
  assetType: EpisodeAssetDesignAssetType,
): Array<{ id: string; name: string }> {
  switch (assetType) {
    case "character":
      return bundle.characters.map((a) => ({ id: a.id, name: a.name }));
    case "scene":
      return bundle.scenes.map((a) => ({ id: a.id, name: a.name }));
    case "prop":
      return bundle.props.map((a) => ({ id: a.id, name: a.name }));
    case "audio":
      return bundle.audios.map((a) => ({ id: a.id, name: a.name }));
  }
}

function findExistingAssetId(
  bundle: MatchableBundle,
  assetType: EpisodeAssetDesignAssetType,
  name: string,
): string | null {
  const normalized = normalizeAssetName(name);
  if (!normalized) return null;
  const assets = listAssetsByType(bundle, assetType);
  const hit = assets.find((a) => normalizeAssetName(a.name) === normalized);
  return hit?.id ?? null;
}

export function matchExistingAssets(
  items: EpisodeAssetDesignItem[],
  bundle: MatchableBundle,
): EpisodeAssetDesignItem[] {
  return items.map((item) => {
    if (item.resolution !== "pending" && item.resolution !== "create_new") {
      return item;
    }
    const existingId = findExistingAssetId(bundle, item.assetType, item.name);
    if (existingId) {
      return {
        ...item,
        resolution: "link_existing" as AssetDesignResolution,
        existingAssetId: existingId,
      };
    }
    return {
      ...item,
      resolution: "create_new" as AssetDesignResolution,
      existingAssetId: null,
    };
  });
}

export function dtoItemsToDesignItems(
  dto: EpisodeAssetDesignGenerationDto,
): EpisodeAssetDesignItem[] {
  return dto.assets.map((asset) => {
    const design = asset.design ?? {};
    const evidence =
      asset.evidence ??
      (typeof (design as Record<string, unknown>).evidence === "string"
        ? ((design as Record<string, unknown>).evidence as string)
        : "");

    if (asset.type === "character") {
      const d = design as Record<string, unknown>;
      const appearance = typeof d.appearance === "string" ? d.appearance : "";
      const designDescription =
        typeof d.description === "string" ? d.description : "";
      return {
        id: "",
        assetType: "character",
        name: asset.name,
        resolution: "pending",
        existingAssetId: null,
        libraryAssetId: null,
        source: "ai",
        draft: {
          description:
            (asset.description ?? designDescription)?.trim() ||
            appearance ||
            "",
          appearance,
          clothing: typeof d.clothing === "string" ? d.clothing : "",
          role: typeof d.role === "string" ? d.role : "",
          age: "",
          voiceId: null,
          voiceName: null,
          voiceBound: false,
          usageInEpisode:
            typeof d.usageInEpisode === "string" ? d.usageInEpisode : "",
          evidence,
        },
      };
    }
    if (asset.type === "scene") {
      const d = design as Record<string, unknown>;
      const location = typeof d.location === "string" ? d.location : "";
      const designDescription =
        typeof d.description === "string" ? d.description : "";
      return {
        id: "",
        assetType: "scene",
        name: asset.name,
        resolution: "pending",
        existingAssetId: null,
        libraryAssetId: null,
        source: "ai",
        draft: {
          description:
            (asset.description ?? designDescription)?.trim() || location || "",
          timeOfDay: typeof d.timeOfDay === "string" ? d.timeOfDay : "",
          location,
          style: typeof d.style === "string" ? d.style : "",
          usageInEpisode:
            typeof d.usageInEpisode === "string" ? d.usageInEpisode : "",
          evidence,
        },
      };
    }
    if (asset.type === "prop") {
      const d = design as Record<string, unknown>;
      const usage = typeof d.usage === "string" ? d.usage : "";
      const designDescription =
        typeof d.description === "string" ? d.description : "";
      return {
        id: "",
        assetType: "prop",
        name: asset.name,
        resolution: "pending",
        existingAssetId: null,
        libraryAssetId: null,
        source: "ai",
        draft: {
          description:
            (asset.description ?? designDescription)?.trim() || usage || "",
          propType: typeof d.propType === "string" ? d.propType : "",
          usage,
          usageInEpisode:
            typeof d.usageInEpisode === "string" ? d.usageInEpisode : "",
          evidence,
        },
      };
    }
    const d = design as Record<string, unknown>;
    const audioKind =
      d.audioKind === "music" ||
      d.audioKind === "sfx" ||
      d.audioKind === "narration" ||
      d.audioKind === "voice"
        ? d.audioKind
        : "music";
    const designDescription =
      typeof d.description === "string" ? d.description : "";
    return {
      id: "",
      assetType: "audio",
      name: asset.name,
      resolution: "pending",
      existingAssetId: null,
      libraryAssetId: null,
      source: "ai",
      draft: {
        description: (asset.description ?? designDescription)?.trim() || "",
        audioKind,
        duration: typeof d.duration === "string" ? d.duration : "",
        source: typeof d.source === "string" ? d.source : "",
        usageInEpisode:
          typeof d.usageInEpisode === "string" ? d.usageInEpisode : "",
        evidence,
      },
    };
  });
}
