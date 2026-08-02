import { describe, expect, it } from "vitest";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
  withDesignMediaVoiceBinding,
} from "@/projects/assets/episode-design/design-media-voice";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

function characterItem(
  overrides: Partial<EpisodeAssetDesignItem> = {},
): EpisodeAssetDesignItem & { assetType: "character" } {
  return {
    id: "item_1",
    name: "江辰",
    assetType: "character",
    resolution: "create_new",
    libraryAssetId: null,
    source: "ai",
    draft: {
      description: "",
      appearance: "",
      clothing: "",
      role: "",
      age: "",
      voiceId: "localvoice_legacy",
      voiceName: "legacy",
      voiceBound: true,
      usageInEpisode: "",
      evidence: "",
    },
    generatedMedia: {
      currentId: "gen_a",
      historyIds: ["gen_a", "gen_b"],
      history: [
        {
          mediaId: "gen_a",
          prompt: "a",
          generatedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          mediaId: "gen_b",
          prompt: "b",
          generatedAt: "2026-08-01T01:00:00.000Z",
        },
      ],
      status: "completed",
      promptFingerprint: null,
      errorMessage: null,
      previewKind: "image",
    },
    ...overrides,
  } as EpisodeAssetDesignItem & { assetType: "character" };
}

describe("design-media-voice", () => {
  it("falls back to draft only for current media (legacy)", () => {
    const item = characterItem();
    const a = getDesignMediaVoiceBinding(item, "gen_a");
    expect(a.voiceId).toBe("localvoice_legacy");
    expect(isMediaVoiceBound(a)).toBe(true);

    const b = getDesignMediaVoiceBinding(item, "gen_b");
    expect(b.voiceId).toBeNull();
    expect(isMediaVoiceBound(b)).toBe(false);
  });

  it("binds voice per mediaId independently", () => {
    const item = characterItem();
    const withB = withDesignMediaVoiceBinding(item, "gen_b", {
      voiceId: "localvoice_b",
      voiceName: "voice-b",
      voiceBound: true,
    });
    expect(getDesignMediaVoiceBinding(withB, "gen_b").voiceId).toBe(
      "localvoice_b",
    );
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(withB, "gen_b"))).toBe(
      true,
    );
    // current is still gen_a — draft mirror unchanged; gen_a keeps legacy
    expect(getDesignMediaVoiceBinding(withB, "gen_a").voiceId).toBe(
      "localvoice_legacy",
    );
  });

  it("mirrors draft when binding current media", () => {
    const item = characterItem();
    const next = withDesignMediaVoiceBinding(item, "gen_a", {
      voiceId: "localvoice_a2",
      voiceName: "a2",
      voiceBound: true,
    });
    expect(next.draft.voiceId).toBe("localvoice_a2");
    expect(next.draft.voiceBound).toBe(true);
    expect(
      next.generatedMedia?.history?.find((h) => h.mediaId === "gen_a")
        ?.voiceBound,
    ).toBe(true);
  });
});
