import { describe, expect, it } from "vitest";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import type { CharacterAsset, VideoRefSafety } from "@/projects/assets/types";
import {
  getCharacterMediaVideoRefSafety,
  isCharacterMediaSd2Certified,
  listCertifiedCharacterMediaIds,
  migrateCharacterMediaVideoRefSafety,
  setCharacterMediaVideoRefSafety,
} from "@/projects/assets/character-media-video-ref";
import { assertDesignItemLibraryGate } from "@/projects/assets/episode-design/confirm-transform";
import { characterNeedsUncheckedVideoRefBlock } from "@/projects/assets/episode-design/design-media-video-ref-labels";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { buildAssetsSummary } from "@/projects/storyboard/api-helpers";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";

function baseCharacter(
  overrides: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "c1",
    projectId: "p1",
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
    imageFileName: "media_primary",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "media_primary",
    approvedMediaIds: ["media_primary"],
    historyMediaIds: [],
    lookMediaIds: [],
    ...overrides,
  };
}

const sd2Ok = (checkedAt = "2026-08-01T00:00:00.000Z"): VideoRefSafety => ({
  status: "ok",
  checkedAt,
  modelId: SD2_CERT_MODEL_TAG,
});

const plainOk: VideoRefSafety = {
  status: "ok",
  checkedAt: "2026-08-01T00:00:00.000Z",
  modelId: "ark-vision-other",
};

describe("character mediaVideoRefSafety helpers", () => {
  it("maps legacy top-level safety only onto current primary", () => {
    const asset = baseCharacter({
      videoRefSafety: sd2Ok(),
      lookMediaIds: ["media_look"],
      approvedMediaIds: ["media_primary", "media_look"],
    });
    expect(getCharacterMediaVideoRefSafety(asset, "media_primary")).toEqual(
      sd2Ok(),
    );
    expect(getCharacterMediaVideoRefSafety(asset, "media_look")).toBeNull();
    expect(isCharacterMediaSd2Certified(asset, "media_look")).toBe(false);
  });

  it("does not treat status=ok without SD2 model as certified", () => {
    const asset = baseCharacter({
      mediaVideoRefSafety: { media_primary: plainOk },
      videoRefSafety: plainOk,
    });
    expect(isCharacterMediaSd2Certified(asset, "media_primary")).toBe(false);
  });

  it("keeps per-media states isolated when writing", () => {
    let asset = baseCharacter({
      lookMediaIds: ["media_look"],
      approvedMediaIds: ["media_primary", "media_look"],
      mediaVideoRefSafety: { media_primary: sd2Ok() },
      videoRefSafety: sd2Ok(),
    });
    asset = setCharacterMediaVideoRefSafety(asset, "media_look", plainOk);
    expect(isCharacterMediaSd2Certified(asset, "media_primary")).toBe(true);
    expect(isCharacterMediaSd2Certified(asset, "media_look")).toBe(false);
    expect(asset.mediaVideoRefSafety?.media_primary).toEqual(sd2Ok());
  });

  it("migrateCharacterMediaVideoRefSafety mirrors primary only", () => {
    const migrated = migrateCharacterMediaVideoRefSafety(
      baseCharacter({
        videoRefSafety: sd2Ok(),
        lookMediaIds: ["media_look"],
        approvedMediaIds: ["media_primary", "media_look"],
      }),
    );
    expect(migrated.mediaVideoRefSafety?.media_primary).toEqual(sd2Ok());
    expect(migrated.mediaVideoRefSafety?.media_look).toBeUndefined();
  });

  it("listCertifiedCharacterMediaIds returns only SD2-certified ids", () => {
    const asset = baseCharacter({
      lookMediaIds: ["media_look", "media_look2"],
      approvedMediaIds: ["media_primary", "media_look", "media_look2"],
      mediaVideoRefSafety: {
        media_primary: sd2Ok(),
        media_look: plainOk,
        media_look2: sd2Ok("2026-08-02T00:00:00.000Z"),
      },
    });
    expect(listCertifiedCharacterMediaIds(asset).sort()).toEqual([
      "media_look2",
      "media_primary",
    ]);
  });
});

describe("design library gate helpers", () => {
  function designItem(
    safety: VideoRefSafety | null,
  ): EpisodeAssetDesignItem {
    return {
      id: "i1",
      assetType: "character",
      name: "角色",
      resolution: "create_new",
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
      generatedMedia: {
        currentId: "gen_1",
        historyIds: ["gen_1"],
        history: [
          {
            mediaId: "gen_1",
            prompt: "",
            generatedAt: "2026-08-01T00:00:00.000Z",
            mimeType: "image/png",
            ...(safety ? { videoRefSafety: safety } : {}),
          },
        ],
        ...(safety ? { videoRefSafety: safety } : {}),
      },
    } as EpisodeAssetDesignItem;
  }

  it("blocks status=ok without SD2 model tag", () => {
    expect(characterNeedsUncheckedVideoRefBlock(designItem(plainOk))).toBe(
      true,
    );
    expect(assertDesignItemLibraryGate(designItem(plainOk))?.code).toBe(
      "VIDEO_REF_REQUIRED",
    );
  });

  it("allows SD2-certified characters", () => {
    expect(characterNeedsUncheckedVideoRefBlock(designItem(sd2Ok()))).toBe(
      false,
    );
    expect(assertDesignItemLibraryGate(designItem(sd2Ok()))).toBeNull();
  });

  it("requires image for scenes", () => {
    const scene = {
      id: "s1",
      assetType: "scene" as const,
      name: "场景",
      resolution: "create_new" as const,
      source: "ai" as const,
      draft: {
        description: "",
        timeOfDay: "",
        location: "",
        style: "",
        usageInEpisode: "",
        evidence: "",
      },
      generatedMedia: null,
    } as unknown as EpisodeAssetDesignItem;
    expect(assertDesignItemLibraryGate(scene)?.code).toBe("IMAGE_REQUIRED");
  });
});

describe("storyboard assets summary cert filter", () => {
  it("hides characters with no certified media and filters looks", () => {
    const draft: AssetBundleDraft = {
      projectId: "p1",
      updatedAt: "2026-08-01T00:00:00.000Z",
      characters: [
        baseCharacter({
          id: "uncert",
          name: "未认证",
          videoRefSafety: plainOk,
          mediaVideoRefSafety: { media_primary: plainOk },
        }),
        baseCharacter({
          id: "cert",
          name: "已认证",
          primaryMediaId: "media_primary",
          imageFileName: "media_primary",
          lookMediaIds: ["media_look"],
          approvedMediaIds: ["media_primary", "media_look"],
          mediaVideoRefSafety: {
            media_primary: sd2Ok(),
            media_look: plainOk,
          },
          videoRefSafety: sd2Ok(),
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    };
    const summary = buildAssetsSummary(draft);
    expect(summary?.characters.map((c) => c.id)).toEqual(["cert"]);
    expect(summary?.characters[0]?.mediaOptions?.map((m) => m.mediaId)).toEqual(
      ["media_primary"],
    );
  });
});
