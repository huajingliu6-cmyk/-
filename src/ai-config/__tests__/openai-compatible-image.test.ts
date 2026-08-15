import { describe, expect, it, vi } from "vitest";
import {
  mapImageSize,
  normalizeImageAspectRatio,
  resolveOpenAiCompatibleImageEndpoint,
  generateOpenAiCompatibleImages,
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

  it("normalizes all supported design aspect ratios", () => {
    expect(normalizeImageAspectRatio("5:4")).toBe("5:4");
    expect(normalizeImageAspectRatio("21:9")).toBe("21:9");
    expect(normalizeImageAspectRatio("2:3")).toBe("2:3");
    expect(normalizeImageAspectRatio("weird")).toBe("16:9");
  });

  it("sends n/size/quality and materializes all returned images", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.n).toBe(4);
      expect(body.size).toBe("16:9");
      expect(body.quality).toBe("high");
      expect(body.resolution).toBe("4k");
      return Response.json({
        data: [
          { b64_json: Buffer.from("img1").toString("base64") },
          { b64_json: Buffer.from("img2").toString("base64") },
          { b64_json: Buffer.from("img3").toString("base64") },
          { b64_json: Buffer.from("img4").toString("base64") },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateOpenAiCompatibleImages({
      endpoint: "https://image.example/v1",
      apiKey: "k",
      prompt: "test",
      aspectRatio: "16:9",
      resolution: "4K",
      quality: "high",
      count: 4,
    });

    expect(result.images).toHaveLength(4);
    expect(result.images[0]?.buffer.toString()).toBe("img1");
    expect(result.images[3]?.buffer.toString()).toBe("img4");
    vi.unstubAllGlobals();
  });

  it.each([
    ["4K", "high", "4k"],
    ["2K", "medium", "2k"],
  ] as const)(
    "uses codesonline's lowercase upscale field for %s output",
    async (resolution, quality, expectedUpscale) => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: "gpt-image-2",
          n: 1,
          size: "16:9",
          quality,
          upscale: expectedUpscale,
        });
        expect(body).not.toHaveProperty("resolution");
        expect(body).not.toHaveProperty("output_size");
        expect(body).not.toHaveProperty("width");
        expect(body).not.toHaveProperty("height");
        expect(body).not.toHaveProperty("characterName");
        return Response.json({
          data: [{ b64_json: Buffer.from("img").toString("base64") }],
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      await generateOpenAiCompatibleImages({
        endpoint: "https://image.codesonline.dev/v1",
        apiKey: "k",
        model: "gpt-image-2",
        prompt: "test",
        aspectRatio: "16:9",
        resolution,
        quality,
        extra: { characterName: "metadata is not an API parameter" },
      });

      vi.unstubAllGlobals();
    },
  );

  it("omits upscale for codesonline 1K output", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.quality).toBe("low");
      expect(body).not.toHaveProperty("upscale");
      return Response.json({
        data: [{ b64_json: Buffer.from("img").toString("base64") }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateOpenAiCompatibleImages({
      endpoint: "https://image.codesonline.dev/v1",
      apiKey: "k",
      model: "gpt-image-2",
      prompt: "test",
      aspectRatio: "16:9",
      resolution: "1K",
      quality: "low",
    });

    vi.unstubAllGlobals();
  });
});
