import { describe, expect, it } from "vitest";
import type { CharacterAsset, SceneAsset } from "@/projects/assets/types";
import { matchExistingAssets } from "@/projects/assets/episode-design/match";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

describe("matchExistingAssets", () => {
  const bundle = {
    characters: [
      { id: "c1", projectId: "p1", name: "林清" } as CharacterAsset,
    ],
    scenes: [
      { id: "s1", projectId: "p1", name: "雨夜（外）" } as SceneAsset,
    ],
    props: [],
    audios: [],
  };

  it("links when same type and normalized name match", () => {
    const items: EpisodeAssetDesignItem[] = [
      {
        id: "i1",
        assetType: "character",
        name: "林清",
        resolution: "pending",
        source: "ai",
        draft: {
          description: "",
          appearance: "",
          clothing: "",
          role: "",
          age: "",
          voiceId: null,
          voiceName: null,
          voiceBound: false,
          usageInEpisode: "",
          evidence: "",
        },
      },
    ];
    const matched = matchExistingAssets(items, bundle);
    expect(matched[0]!.resolution).toBe("link_existing");
    expect(matched[0]!.existingAssetId).toBe("c1");
  });

  it("sets create_new when no match", () => {
    const items: EpisodeAssetDesignItem[] = [
      {
        id: "i2",
        assetType: "prop",
        name: "旧伞",
        resolution: "pending",
        source: "ai",
        draft: {
          description: "",
          propType: "",
          usage: "",
          usageInEpisode: "",
          evidence: "",
        },
      },
    ];
    const matched = matchExistingAssets(items, bundle);
    expect(matched[0]!.resolution).toBe("create_new");
    expect(matched[0]!.existingAssetId).toBeNull();
  });

  it("normalizes punctuation for scene names", () => {
    const items: EpisodeAssetDesignItem[] = [
      {
        id: "i3",
        assetType: "scene",
        name: "雨夜(外)",
        resolution: "pending",
        source: "ai",
        draft: {
          description: "",
          timeOfDay: "",
          location: "",
          style: "",
          usageInEpisode: "",
          evidence: "",
        },
      },
    ];
    const matched = matchExistingAssets(items, bundle);
    expect(matched[0]!.resolution).toBe("link_existing");
    expect(matched[0]!.existingAssetId).toBe("s1");
  });
});
