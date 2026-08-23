import { describe, expect, it } from "vitest";
import {
  collectLibraryAssetVariantMediaIds,
  defaultLibraryVariantLabel,
  resolveLibraryAssetPrimaryMediaId,
  withoutLibraryVariantMedia,
} from "@/projects/assets/library-asset-media-variants";
import type { SceneAsset } from "@/projects/assets/types";

function scene(overrides: Partial<SceneAsset> = {}): SceneAsset {
  return {
    id: "scene_1",
    projectId: "proj_1",
    name: "江北岭别墅外",
    sceneType: "",
    description: "",
    timeOfDay: "",
    location: "",
    style: "",
    imageFileName: "scene_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "draft",
    primaryMediaId: "scene_1",
    approvedMediaIds: ["scene_1", "gen_a", "gen_b"],
    ...overrides,
  };
}

describe("library asset media variants", () => {
  it("resolves primary and non-primary variants", () => {
    const asset = scene();
    expect(resolveLibraryAssetPrimaryMediaId(asset)).toBe("scene_1");
    expect(collectLibraryAssetVariantMediaIds(asset)).toEqual({
      primaryMediaId: "scene_1",
      variantMediaIds: ["gen_a", "gen_b"],
    });
  });

  it("merges pending generated media ids into variants", () => {
    const asset = scene({ approvedMediaIds: ["scene_1"] });
    expect(
      collectLibraryAssetVariantMediaIds(asset, ["gen_new"]).variantMediaIds,
    ).toEqual(["gen_new"]);
  });

  it("builds default scene version labels", () => {
    expect(defaultLibraryVariantLabel("别墅外", 2, "scene")).toBe(
      "别墅外·场景版本 2",
    );
  });

  it("resolves primary from asset id when imageFileName is display-only", () => {
    const asset = scene({
      imageFileName: "hero.png",
      primaryMediaId: null,
      approvedMediaIds: [],
    });
    expect(resolveLibraryAssetPrimaryMediaId(asset)).toBe("scene_1");
  });

  it("removes variant media without touching unrelated labels", () => {
    const next = withoutLibraryVariantMedia(
      scene({
        mediaVariantLabels: { gen_a: "夜景版", gen_b: "雨夜版" },
      }),
      "gen_a",
    );
    expect(next.approvedMediaIds).toEqual(["scene_1", "gen_b"]);
    expect(next.mediaVariantLabels).toEqual({ gen_b: "雨夜版" });
  });
});
