import { describe, expect, it } from "vitest";
import {
  designCardApprovalUi,
  findRemovedApprovedDesignItems,
  isApprovedEpisodeDesignItem,
  resolveDesignItemPreviewUrl,
} from "@/projects/assets/episode-design/approved-item";
import type {
  CharacterDesignItem,
  EpisodeAssetDesignItem,
} from "@/projects/assets/episode-design/types";

function baseItem(
  overrides: Partial<CharacterDesignItem> & { id: string; name: string },
): CharacterDesignItem {
  return {
    assetType: "character",
    resolution: "create_new",
    source: "manual",
    draft: {
      role: "主角",
      description: "d",
      appearance: "a",
      clothing: "c",
      age: "20",
      voiceId: null,
      voiceName: null,
      voiceBound: false,
      usageInEpisode: "u",
      evidence: "e",
    },
    ...overrides,
  };
}

describe("approved episode design item guard", () => {
  it("detects libraryAssetId and approvedIds", () => {
    expect(
      isApprovedEpisodeDesignItem(baseItem({ id: "a", name: "A" })),
    ).toBe(false);
    expect(
      isApprovedEpisodeDesignItem(
        baseItem({ id: "b", name: "B", libraryAssetId: "lib_1" }),
      ),
    ).toBe(true);
    expect(
      isApprovedEpisodeDesignItem(
        baseItem({
          id: "c",
          name: "C",
          generatedMedia: {
            currentId: "m1",
            historyIds: ["m1"],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            approvedIds: ["m1"],
          },
        }),
      ),
    ).toBe(true);
  });

  it("maps card approval ui for pending vs approved media", () => {
    const pendingItem = baseItem({
      id: "p",
      name: "P",
      generatedMedia: {
        currentId: "media_pending",
        historyIds: ["media_pending"],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
      },
    });
    expect(
      designCardApprovalUi(pendingItem, new Set(["media_pending"]), new Set()),
    ).toBe("pending");
    expect(
      designCardApprovalUi(
        pendingItem,
        new Set(),
        new Set(["media_pending"]),
      ),
    ).toBe("approved");
  });

  it("finds approved items removed from next list", () => {
    const previous = [
      baseItem({ id: "keep", name: "Keep" }),
      baseItem({ id: "approved", name: "Approved", libraryAssetId: "lib" }),
      baseItem({ id: "pending", name: "Pending" }),
    ];
    const next = [
      baseItem({ id: "keep", name: "Keep" }),
      baseItem({ id: "pending", name: "Pending" }),
    ];
    const removed = findRemovedApprovedDesignItems(previous, next);
    expect(removed.map((i) => i.id)).toEqual(["approved"]);
  });

  it("resolves preview url without requiring previewKind image", () => {
    expect(
      resolveDesignItemPreviewUrl(
        "p1",
        baseItem({
          id: "x",
          name: "X",
          generatedMedia: {
            currentId: "gen_abc",
            historyIds: ["gen_abc"],
            status: "completed",
            promptFingerprint: null,
            errorMessage: null,
            previewKind: null,
          },
        }),
      ),
    ).toBe("/api/projects/p1/assets-draft/images/gen_abc");
  });

  it("falls back to library asset image for approved items", () => {
    expect(
      resolveDesignItemPreviewUrl(
        "p1",
        baseItem({
          id: "x",
          name: "X",
          libraryAssetId: "lib_char",
        }),
        {
          characters: [
            {
              id: "lib_char",
              imageFileName: "gen_libmedia",
              imageObjectUrl: null,
              primaryMediaId: "gen_libmedia",
            },
          ],
          scenes: [],
          props: [],
        },
      ),
    ).toBe("/api/projects/p1/assets-draft/images/gen_libmedia");
  });
});
