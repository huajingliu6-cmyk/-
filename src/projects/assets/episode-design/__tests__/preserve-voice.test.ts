import { describe, expect, it } from "vitest";
import { preserveApprovedCharacterVoice } from "@/projects/assets/episode-design/approved-item";
import type { CharacterDesignItem } from "@/projects/assets/episode-design/types";

function characterItem(
  partial: Partial<CharacterDesignItem> = {},
  draftPatch: Partial<CharacterDesignItem["draft"]> = {},
): CharacterDesignItem {
  return {
    id: "c1",
    name: "Jiang",
    resolution: "create_new",
    source: "manual",
    assetType: "character",
    libraryAssetId: "lib_1",
    ...partial,
    draft: {
      description: "",
      appearance: "",
      clothing: "",
      role: "",
      age: "",
      voiceId: "localvoice_abc",
      voiceName: "mature",
      voiceBound: true,
      usageInEpisode: "",
      evidence: "",
      ...draftPatch,
    },
  };
}

describe("preserveApprovedCharacterVoice", () => {
  it("keeps approved character voice when client tries to change it", () => {
    const server = characterItem();
    const client = characterItem(
      {},
      { voiceId: "other", voiceName: "other", voiceBound: false },
    );
    const next = preserveApprovedCharacterVoice(server, client);
    expect(next.assetType).toBe("character");
    if (next.assetType === "character") {
      expect(next.draft.voiceId).toBe("localvoice_abc");
      expect(next.draft.voiceName).toBe("mature");
      expect(next.draft.voiceBound).toBe(true);
    }
  });

  it("allows voice changes before approval", () => {
    const server = characterItem({ libraryAssetId: null });
    const client = characterItem(
      { libraryAssetId: null },
      { voiceId: "other", voiceName: "other", voiceBound: true },
    );
    const next = preserveApprovedCharacterVoice(server, client);
    if (next.assetType === "character") {
      expect(next.draft.voiceId).toBe("other");
    }
  });
});
