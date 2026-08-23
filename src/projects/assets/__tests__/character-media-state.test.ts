import { describe, expect, it } from "vitest";
import type { CharacterAsset } from "@/projects/assets/types";
import {
  addCharacterLook,
  clearCharacterPrimary,
  listCharacterHistoryMediaIds,
  listCharacterLookMediaIds,
  moveCharacterHistoryToLook,
  normalizeCharacterMediaLists,
  setCharacterPrimary,
} from "@/projects/assets/character-media-state";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

function baseCharacter(
  partial: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "char_1",
    projectId: "proj_1",
    name: "林清",
    role: "女主",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    status: "draft",
    ...partial,
  };
}

describe("character media state helpers", () => {
  it("migrates legacy approved-minus-primary into lookMediaIds", () => {
    const normalized = normalizeCharacterMediaLists(
      baseCharacter({
        primaryMediaId: "p1",
        imageFileName: "p1",
        approvedMediaIds: ["p1", "look_a", "look_b"],
      }),
    );
    expect(normalized.primaryMediaId).toBe("p1");
    expect(normalized.historyMediaIds).toEqual([]);
    expect(normalized.lookMediaIds).toEqual(["look_a", "look_b"]);
    expect(normalized.approvedMediaIds).toEqual(["p1", "look_a", "look_b"]);
  });

  it("setCharacterPrimary moves old primary into history and removes next from lists", () => {
    const next = setCharacterPrimary(
      baseCharacter({
        primaryMediaId: "p1",
        historyMediaIds: ["h1", "p2"],
        lookMediaIds: ["p2", "look_1"],
        approvedMediaIds: ["p1", "h1", "p2", "look_1"],
        mediaVoices: {
          p2: { voiceId: "v2", voiceName: "音色2" },
        },
        voiceId: "v1",
        voiceName: "音色1",
        videoRefSafety: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
        mediaVideoRefSafety: {
          p1: {
            status: "ok",
            checkedAt: "2026-01-01T00:00:00.000Z",
            modelId: SD2_CERT_MODEL_TAG,
          },
        },
      }),
      "p2",
    );
    expect(next.primaryMediaId).toBe("p2");
    expect(next.historyMediaIds).toEqual(["p1", "h1"]);
    expect(next.lookMediaIds).toEqual(["look_1"]);
    expect(next.approvedMediaIds).toEqual(["p2", "p1", "h1", "look_1"]);
    // Voice is character-scoped — switching primary must not adopt mediaVoices.
    expect(next.voiceId).toBe("v1");
    expect(next.voiceName).toBe("音色1");
    expect(next.videoRefSafety).toBeNull();
    expect(next.mediaVideoRefSafety?.p1?.modelId).toBe(SD2_CERT_MODEL_TAG);
  });

  it("setCharacterPrimary mirrors certified safety for the new primary", () => {
    const cert = {
      status: "ok" as const,
      checkedAt: "2026-01-02T00:00:00.000Z",
      modelId: SD2_CERT_MODEL_TAG,
    };
    const next = setCharacterPrimary(
      baseCharacter({
        primaryMediaId: "p1",
        historyMediaIds: ["p2"],
        lookMediaIds: [],
        approvedMediaIds: ["p1", "p2"],
        mediaVideoRefSafety: {
          p1: {
            status: "ok",
            checkedAt: "2026-01-01T00:00:00.000Z",
            modelId: SD2_CERT_MODEL_TAG,
          },
          p2: cert,
        },
        videoRefSafety: {
          status: "ok",
          checkedAt: "2026-01-01T00:00:00.000Z",
          modelId: SD2_CERT_MODEL_TAG,
        },
      }),
      "p2",
    );
    expect(next.videoRefSafety).toEqual(cert);
    expect(next.mediaVideoRefSafety?.p1?.modelId).toBe(SD2_CERT_MODEL_TAG);
    expect(next.mediaVideoRefSafety?.p2).toEqual(cert);
  });

  it("replace primary twice keeps history order without duplicates", () => {
    let asset = baseCharacter({
      primaryMediaId: "p0",
      historyMediaIds: [],
      lookMediaIds: [],
      approvedMediaIds: ["p0"],
    });
    asset = setCharacterPrimary(asset, "p1");
    asset = setCharacterPrimary(asset, "p2");
    expect(asset.primaryMediaId).toBe("p2");
    expect(asset.historyMediaIds).toEqual(["p1", "p0"]);
    expect(asset.approvedMediaIds).toEqual(["p2", "p1", "p0"]);
  });

  it("moveCharacterHistoryToLook keeps primary and approved membership", () => {
    const next = moveCharacterHistoryToLook(
      baseCharacter({
        primaryMediaId: "p1",
        historyMediaIds: ["h1", "h2"],
        lookMediaIds: ["look_1"],
        approvedMediaIds: ["p1", "h1", "h2", "look_1"],
      }),
      "h1",
    );
    expect(next.primaryMediaId).toBe("p1");
    expect(next.historyMediaIds).toEqual(["h2"]);
    expect(next.lookMediaIds).toEqual(["look_1", "h1"]);
    expect(next.approvedMediaIds).toContain("h1");
    expect(listCharacterHistoryMediaIds(next)).toEqual(["h2"]);
    expect(listCharacterLookMediaIds(next)).toEqual(["look_1", "h1"]);
  });

  it("addCharacterLook does not touch history or primary", () => {
    const next = addCharacterLook(
      baseCharacter({
        primaryMediaId: "p1",
        historyMediaIds: ["h1"],
        lookMediaIds: [],
        approvedMediaIds: ["p1", "h1"],
      }),
      "look_new",
    );
    expect(next.primaryMediaId).toBe("p1");
    expect(next.historyMediaIds).toEqual(["h1"]);
    expect(next.lookMediaIds).toEqual(["look_new"]);
    expect(next.approvedMediaIds).toEqual(["p1", "h1", "look_new"]);
  });

  it("approvedMediaIds always covers primary + history + look", () => {
    const next = setCharacterPrimary(
      addCharacterLook(
        baseCharacter({
          primaryMediaId: "p1",
          historyMediaIds: [],
          lookMediaIds: [],
          approvedMediaIds: ["p1"],
        }),
        "look_1",
      ),
      "p2",
    );
    expect(next.approvedMediaIds).toEqual(
      expect.arrayContaining(["p2", "p1", "look_1"]),
    );
  });

  it("clearCharacterPrimary clears primary image fields and default voice, keeps looks", () => {
    const cleared = clearCharacterPrimary(
      baseCharacter({
        primaryMediaId: "p1",
        imageFileName: "p1.png",
        imageObjectUrl: "blob:http://localhost/p1",
        imageMimeType: "image/png",
        voiceId: "v_default",
        voiceName: "默认音色",
        historyMediaIds: ["h1"],
        lookMediaIds: ["look_a"],
        approvedMediaIds: ["p1", "h1", "look_a"],
        appearances: [
          {
            id: "look_a",
            name: "造型 A",
            promptOverride: "",
            currentMediaId: "look_a",
            mediaHistory: ["look_a"],
            voiceOverrideId: "v_look",
            voiceOverrideName: "造型音色",
            revision: 1,
          },
        ],
      }),
    );
    expect(cleared.primaryMediaId).toBeNull();
    expect(cleared.imageFileName).toBeNull();
    expect(cleared.imageObjectUrl).toBeNull();
    expect(cleared.imageMimeType).toBeNull();
    expect(cleared.voiceId).toBeNull();
    expect(cleared.voiceName).toBeNull();
    expect(cleared.lookMediaIds).toEqual(["look_a"]);
    expect(cleared.historyMediaIds).toEqual(["h1"]);
    expect(cleared.approvedMediaIds).toEqual(["h1", "look_a"]);
    expect(cleared.approvedMediaIds).not.toContain("p1");
    expect(cleared.appearances?.[0]?.currentMediaId).toBe("look_a");
    expect(cleared.appearances?.[0]?.voiceOverrideId).toBe("v_look");
  });
});
