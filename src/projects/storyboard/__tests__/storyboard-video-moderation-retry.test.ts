import { describe, expect, it } from "vitest";
import {
  missingBoundCharacterReferences,
  omitCharacterReferencesFromInput,
  resolveRealPersonSubmitStrategy,
} from "@/projects/storyboard/services/storyboard-video-generate";
import { isRealPersonModerationError } from "@/video-generation/user-facing-error";
import type { VideoGenerationInput } from "@/video-generation/types";

function baseInput(
  overrides: Partial<VideoGenerationInput> = {},
): VideoGenerationInput {
  return {
    shotId: "shot_1",
    projectId: "p_1",
    prompt: "test",
    resolution: "720P",
    aspectRatio: "16:9",
    durationSeconds: 5,
    watermark: false,
    promptExtend: true,
    characterReferences: [
      {
        assetId: "char_1",
        kind: "character",
        label: "江宸",
        mimeType: "image/png",
        sourceUrl: "/x",
      },
    ],
    sceneReferences: [
      {
        assetId: "scene_1",
        kind: "scene",
        label: "办公室",
        mimeType: "image/png",
        sourceUrl: "/y",
      },
    ],
    imageReferences: [],
    referenceVideos: [],
    orderedReferenceMedia: [
      {
        assetId: "char_1",
        kind: "character",
        label: "江宸",
        mimeType: "image/png",
        sourceUrl: "/x",
      },
      {
        assetId: "scene_1",
        kind: "scene",
        label: "办公室",
        mimeType: "image/png",
        sourceUrl: "/y",
      },
    ],
    textInputs: [],
    referenceSelectionMode: "manual",
    selectedReferenceAssetIds: ["char_1", "scene_1"],
    ...overrides,
  };
}

describe("omitCharacterReferencesFromInput", () => {
  it("drops character refs and keeps scene", () => {
    const next = omitCharacterReferencesFromInput(baseInput());
    expect(next).not.toBeNull();
    expect(next!.characterReferences).toEqual([]);
    expect(next!.orderedReferenceMedia.map((r) => r.assetId)).toEqual([
      "scene_1",
    ]);
    expect(next!.selectedReferenceAssetIds).toEqual(["scene_1"]);
  });

  it("returns null when no character refs", () => {
    expect(
      omitCharacterReferencesFromInput(
        baseInput({
          characterReferences: [],
          orderedReferenceMedia: [
            {
              assetId: "scene_1",
              kind: "scene",
              label: "办公室",
              mimeType: "image/png",
              sourceUrl: "/y",
            },
          ],
          selectedReferenceAssetIds: ["scene_1"],
        }),
      ),
    ).toBeNull();
  });
});

describe("isRealPersonModerationError", () => {
  it("detects ark real person rejection", () => {
    expect(
      isRealPersonModerationError(
        "内容审核未通过：参考图疑似包含真人照片。请改用…",
      ),
    ).toBe(true);
    expect(
      isRealPersonModerationError(
        "方舟创建任务失败（400）：may contain real person",
      ),
    ).toBe(true);
    expect(isRealPersonModerationError("模型不存在")).toBe(false);
  });
});

describe("resolveRealPersonSubmitStrategy (block when characters cannot be referenced)", () => {
  it("Ark without SD platform: blocks VLM-flagged characters (no omit)", () => {
    const s = resolveRealPersonSubmitStrategy({
      dialectIsSd2: false,
      sd2PlatformConfigured: false,
      skippedCharacterNames: ["江宸"],
    });
    expect(s.omitCharacters).toBe(false);
    expect(s.blockSubmit).toBe(true);
    expect(s.charactersSkippedForRealPerson).toEqual(["江宸"]);
    expect(s.blockMessage).toContain("禁止");
  });

  it("Ark with SD platform: blocks SD-rejected characters (no omit)", () => {
    const s = resolveRealPersonSubmitStrategy({
      dialectIsSd2: false,
      sd2PlatformConfigured: true,
      skippedCharacterNames: ["江宸"],
    });
    expect(s.omitCharacters).toBe(false);
    expect(s.blockSubmit).toBe(true);
    expect(s.blockMessage).toContain("SD");
    expect(s.charactersSkippedForRealPerson).toEqual(["江宸"]);
  });

  it("SD2 video dialect: keeps characters (provider certifies)", () => {
    const s = resolveRealPersonSubmitStrategy({
      dialectIsSd2: true,
      sd2PlatformConfigured: true,
      skippedCharacterNames: ["江宸"],
    });
    expect(s.omitCharacters).toBe(false);
    expect(s.blockSubmit).toBe(false);
    expect(s.charactersSkippedForRealPerson).toEqual(["江宸"]);
    expect(s.notice).toContain("SD2");
  });
});

describe("missingBoundCharacterReferences", () => {
  it("lists bound characters absent from reference list", () => {
    expect(
      missingBoundCharacterReferences({
        characterIds: ["char_1", "char_2"],
        characters: [
          { id: "char_1", name: "江宸" },
          { id: "char_2", name: "苏晚璃" },
        ],
        characterReferences: [{ assetId: "char_1" }],
      }),
    ).toEqual(["苏晚璃"]);
  });

  it("returns empty when all bound characters are referenced", () => {
    expect(
      missingBoundCharacterReferences({
        characterIds: ["char_1"],
        characters: [{ id: "char_1", name: "江宸" }],
        characterReferences: [{ assetId: "char_1" }],
      }),
    ).toEqual([]);
  });
});
