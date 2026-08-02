import { describe, expect, it } from "vitest";
import { buildAssetsSummary } from "@/projects/storyboard/api-helpers";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";

describe("storyboard asset mediaOptions", () => {
  it("exposes multiple approved media ids for picker history", () => {
    const draft: AssetBundleDraft = {
      projectId: "p_media_opts",
      updatedAt: new Date().toISOString(),
      characters: [
        {
          id: "c1",
          projectId: "p_media_opts",
          name: "江宸",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: "gen_a",
          imageObjectUrl: null,
          imageMimeType: "image/png",
          status: "completed",
          primaryMediaId: "gen_a",
          approvedMediaIds: ["gen_a", "gen_b", "gen_c"],
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    };
    const summary = buildAssetsSummary(draft);
    expect(summary?.characters[0]?.mediaOptions?.map((m) => m.mediaId)).toEqual(
      ["gen_a", "gen_b", "gen_c"],
    );
    expect(
      summary?.characters[0]?.mediaOptions?.find((m) => m.mediaId === "gen_a")
        ?.isPrimary,
    ).toBe(true);
  });

  it("omits mediaOptions when only one image", () => {
    const draft: AssetBundleDraft = {
      projectId: "p_media_one",
      updatedAt: new Date().toISOString(),
      characters: [
        {
          id: "c1",
          projectId: "p_media_one",
          name: "单图",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: "gen_only",
          imageObjectUrl: null,
          imageMimeType: "image/png",
          status: "completed",
          primaryMediaId: "gen_only",
          approvedMediaIds: ["gen_only"],
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    };
    const summary = buildAssetsSummary(draft);
    expect(summary?.characters[0]?.mediaOptions).toBeUndefined();
  });
});
