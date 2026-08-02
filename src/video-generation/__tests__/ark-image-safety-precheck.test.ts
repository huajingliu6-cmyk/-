import { describe, expect, it } from "vitest";
import {
  parseArkVisionPrecheckResponse,
  needsVideoRefPrecheck,
  isLikelyRealPersonForVideoRef,
} from "@/video-generation/ark-image-safety-precheck";
import { omitCharacterReferencesFromInput } from "@/projects/storyboard/services/storyboard-video-generate";
import type { VideoGenerationInput } from "@/video-generation/types";
import type { VideoRefSafety } from "@/projects/assets/types";

describe("parseArkVisionPrecheckResponse", () => {
  it("parses likely_real_person JSON", () => {
    const r = parseArkVisionPrecheckResponse(
      '```json\n{"status":"likely_real_person","reason":"写实人脸剧照"}\n```',
    );
    expect(r.status).toBe("likely_real_person");
    expect(r.reason).toContain("写实");
  });

  it("parses ok", () => {
    expect(
      parseArkVisionPrecheckResponse('{"status":"ok","reason":"插画设定图"}')
        .status,
    ).toBe("ok");
  });

  it("marks invalid payload as check_failed", () => {
    expect(parseArkVisionPrecheckResponse("not json").status).toBe(
      "check_failed",
    );
  });
});

describe("needsVideoRefPrecheck / isLikelyRealPersonForVideoRef", () => {
  it("needs check when missing or pending", () => {
    expect(needsVideoRefPrecheck(undefined)).toBe(true);
    expect(needsVideoRefPrecheck(null)).toBe(true);
    expect(
      needsVideoRefPrecheck({
        status: "pending",
        checkedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      needsVideoRefPrecheck({
        status: "ok",
        checkedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("detects likely real person", () => {
    const safety: VideoRefSafety = {
      status: "likely_real_person",
      checkedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isLikelyRealPersonForVideoRef(safety)).toBe(true);
    expect(isLikelyRealPersonForVideoRef({ ...safety, status: "ok" })).toBe(
      false,
    );
  });
});

describe("omitCharacterReferencesFromInput for precheck gate", () => {
  it("drops character refs so Seedance is not called with them", () => {
    const input: VideoGenerationInput = {
      shotId: "s1",
      projectId: "p1",
      prompt: "x",
      resolution: "720P",
      aspectRatio: "16:9",
      durationSeconds: 5,
      watermark: false,
      promptExtend: true,
      characterReferences: [
        {
          assetId: "c1",
          kind: "character",
          label: "江宸",
          mimeType: "image/png",
          sourceUrl: "/c",
        },
      ],
      sceneReferences: [
        {
          assetId: "sc1",
          kind: "scene",
          label: "办公室",
          mimeType: "image/png",
          sourceUrl: "/s",
        },
      ],
      imageReferences: [],
      referenceVideos: [],
      orderedReferenceMedia: [
        {
          assetId: "c1",
          kind: "character",
          label: "江宸",
          mimeType: "image/png",
          sourceUrl: "/c",
        },
        {
          assetId: "sc1",
          kind: "scene",
          label: "办公室",
          mimeType: "image/png",
          sourceUrl: "/s",
        },
      ],
      textInputs: [],
      referenceSelectionMode: "manual",
      selectedReferenceAssetIds: ["c1", "sc1"],
    };
    const next = omitCharacterReferencesFromInput(input);
    expect(next?.characterReferences).toEqual([]);
    expect(next?.orderedReferenceMedia.map((r) => r.assetId)).toEqual(["sc1"]);
  });
});
