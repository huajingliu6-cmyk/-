import { describe, expect, it } from "vitest";
import { resolveVideoRefSafetyFromDesignMedia } from "@/projects/assets/approvals/promote";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

function characterItem(
  overrides: Partial<EpisodeAssetDesignItem> & {
    generatedMedia?: EpisodeAssetDesignItem["generatedMedia"];
  },
): EpisodeAssetDesignItem {
  return {
    id: "item_1",
    name: "江宸",
    assetType: "character",
    resolution: "create_new",
    libraryAssetId: null,
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
    ...overrides,
  } as EpisodeAssetDesignItem;
}

describe("resolveVideoRefSafetyFromDesignMedia", () => {
  it("reads current media videoRefSafety", () => {
    const safety = {
      status: "likely_real_person" as const,
      checkedAt: "2026-07-31T00:00:00.000Z",
      reason: "face",
    };
    const item = characterItem({
      generatedMedia: {
        currentId: "gen_1",
        historyIds: ["gen_1"],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        videoRefSafety: safety,
      },
    });
    expect(resolveVideoRefSafetyFromDesignMedia(item, "gen_1")).toEqual(safety);
  });

  it("reads history entry for non-current mediaId", () => {
    const histSafety = {
      status: "ok" as const,
      checkedAt: "2026-07-31T00:00:00.000Z",
    };
    const item = characterItem({
      generatedMedia: {
        currentId: "gen_2",
        historyIds: ["gen_1", "gen_2"],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        videoRefSafety: {
          status: "likely_real_person",
          checkedAt: "2026-07-31T01:00:00.000Z",
        },
        history: [
          {
            mediaId: "gen_1",
            prompt: "a",
            generatedAt: "2026-07-30T00:00:00.000Z",
            videoRefSafety: histSafety,
          },
          {
            mediaId: "gen_2",
            prompt: "b",
            generatedAt: "2026-07-31T00:00:00.000Z",
          },
        ],
      },
    });
    expect(resolveVideoRefSafetyFromDesignMedia(item, "gen_1")).toEqual(
      histSafety,
    );
  });

  it("returns null when media has no safety", () => {
    const item = characterItem({
      generatedMedia: {
        currentId: "gen_1",
        historyIds: ["gen_1"],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
      },
    });
    expect(resolveVideoRefSafetyFromDesignMedia(item, "gen_1")).toBeNull();
  });
});
