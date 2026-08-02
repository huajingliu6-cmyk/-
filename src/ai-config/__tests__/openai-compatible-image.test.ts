import { describe, expect, it } from "vitest";
import {
  mapImageSize,
  resolveOpenAiCompatibleImageEndpoint,
} from "@/ai-config/openai-compatible-image";

describe("openai-compatible image endpoint", () => {
  it("appends /images/generations to OpenAI-style base URLs", () => {
    expect(
      resolveOpenAiCompatibleImageEndpoint("https://image.codesonline.dev/v1"),
    ).toBe("https://image.codesonline.dev/v1/images/generations");
    expect(
      resolveOpenAiCompatibleImageEndpoint("https://image.codesonline.dev/v1/"),
    ).toBe("https://image.codesonline.dev/v1/images/generations");
  });

  it("keeps explicit image routes unchanged", () => {
    expect(
      resolveOpenAiCompatibleImageEndpoint(
        "https://image.codesonline.dev/v1/images/generations",
      ),
    ).toBe("https://image.codesonline.dev/v1/images/generations");
    expect(
      resolveOpenAiCompatibleImageEndpoint(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
      ),
    ).toContain("text2image");
  });

  it("maps 16:9 + 4K to true 4K pixels (not 1080P)", () => {
    expect(mapImageSize({ aspectRatio: "16:9", resolution: "4K" })).toBe(
      "3840x2160",
    );
    expect(mapImageSize({ aspectRatio: "9:16", resolution: "4K" })).toBe(
      "2160x3840",
    );
    expect(mapImageSize({ aspectRatio: "16:9", resolution: "2K" })).toBe(
      "2560x1440",
    );
    expect(mapImageSize({ aspectRatio: "16:9", resolution: "1K" })).toBe(
      "1920x1080",
    );
  });
});
