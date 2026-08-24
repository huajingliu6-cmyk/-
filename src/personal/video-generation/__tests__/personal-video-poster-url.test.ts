import { describe, expect, it } from "vitest";
import {
  isPersonalVideoImagePosterUrl,
  normalizePersonalVideoPosterUrl,
  personalVideoPreviewSeekSrc,
} from "@/personal/video-generation/poster-url";

describe("personal video poster url", () => {
  it("rejects generated video asset urls as image posters", () => {
    const videoUrl =
      "/api/assets/22222222-2222-4222-8222-222222222222?generationId=11111111-1111-4111-8111-111111111111";
    expect(isPersonalVideoImagePosterUrl(videoUrl)).toBe(false);
    expect(
      normalizePersonalVideoPosterUrl(videoUrl, videoUrl),
    ).toBeNull();
  });

  it("accepts material media posters", () => {
    expect(
      isPersonalVideoImagePosterUrl("/api/materials/media/abc123"),
    ).toBe(true);
  });

  it("adds a light seek hint for video cover previews", () => {
    expect(personalVideoPreviewSeekSrc("/api/assets/demo")).toBe(
      "/api/assets/demo#t=0.1",
    );
    expect(personalVideoPreviewSeekSrc("/api/assets/demo#t=0.5")).toBe(
      "/api/assets/demo#t=0.5",
    );
  });
});
