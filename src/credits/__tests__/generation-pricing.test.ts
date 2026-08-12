import { describe, expect, it } from "vitest";
import {
  IMAGE_FIRST_GENERATION_CREDITS,
  IMAGE_SUBSEQUENT_GENERATION_CREDITS,
  VIDEO_CREDITS_PER_SECOND_480P,
  VIDEO_CREDITS_PER_SECOND_720P,
  VIDEO_CREDIT_PRICE_NOT_CONFIGURED,
  estimateAssetImageCredits,
  estimateStoryboardVideoCredits,
  isFirstImageGeneration,
  quoteStoryboardVideoCredits,
} from "@/credits/generation-pricing";

describe("generation-pricing", () => {
  it("charges 2 for first image and 1 for subsequent; scales by count", () => {
    expect(isFirstImageGeneration(null)).toBe(true);
    expect(isFirstImageGeneration({ currentId: null, historyIds: [], history: [] })).toBe(
      true,
    );
    expect(estimateAssetImageCredits(null)).toEqual({
      points: IMAGE_FIRST_GENERATION_CREDITS,
      firstGeneration: true,
    });
    expect(estimateAssetImageCredits(null, 4)).toEqual({
      points:
        IMAGE_FIRST_GENERATION_CREDITS +
        3 * IMAGE_SUBSEQUENT_GENERATION_CREDITS,
      firstGeneration: true,
    });

    expect(
      isFirstImageGeneration({
        currentId: "media_1",
        historyIds: [],
        history: [],
      }),
    ).toBe(false);
    expect(
      isFirstImageGeneration({
        currentId: null,
        historyIds: ["media_2"],
        history: [],
      }),
    ).toBe(false);
    expect(
      isFirstImageGeneration({
        currentId: null,
        historyIds: [],
        history: [
          {
            mediaId: "media_3",
            prompt: "p",
            generatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(false);
    expect(
      estimateAssetImageCredits({
        currentId: "media_1",
        historyIds: ["media_1"],
        history: [],
      }),
    ).toEqual({
      points: IMAGE_SUBSEQUENT_GENERATION_CREDITS,
      firstGeneration: false,
    });
    expect(
      estimateAssetImageCredits(
        {
          currentId: "media_1",
          historyIds: ["media_1"],
          history: [],
        },
        4,
      ),
    ).toEqual({
      points: 4 * IMAGE_SUBSEQUENT_GENERATION_CREDITS,
      firstGeneration: false,
    });
  });

  it("quotes 480P at 5/sec and 720P at 10/sec", () => {
    expect(quoteStoryboardVideoCredits({ resolution: "480P", durationSeconds: 8 })).toEqual({
      ok: true,
      points: 8 * VIDEO_CREDITS_PER_SECOND_480P,
      resolution: "480P",
      durationSeconds: 8,
      pointsPerSecond: VIDEO_CREDITS_PER_SECOND_480P,
    });
    expect(quoteStoryboardVideoCredits({ resolution: "720P", durationSeconds: 10 })).toEqual({
      ok: true,
      points: 10 * VIDEO_CREDITS_PER_SECOND_720P,
      resolution: "720P",
      durationSeconds: 10,
      pointsPerSecond: VIDEO_CREDITS_PER_SECOND_720P,
    });
    expect(estimateStoryboardVideoCredits({ resolution: "480P", durationSeconds: 5 })).toBe(25);
    expect(estimateStoryboardVideoCredits({ resolution: "720P", durationSeconds: 5 })).toBe(50);
  });

  it("blocks 1080P when price is not configured", () => {
    const quote = quoteStoryboardVideoCredits({
      resolution: "1080P",
      durationSeconds: 10,
    });
    expect(quote).toMatchObject({
      ok: false,
      code: VIDEO_CREDIT_PRICE_NOT_CONFIGURED,
      resolution: "1080P",
    });
    expect(
      estimateStoryboardVideoCredits({ resolution: "1080P", durationSeconds: 10 }),
    ).toBeNull();
  });
});
