import { describe, expect, it, vi } from "vitest";
import {
  mapImageSize,
  normalizeImageAspectRatio,
  resolveOpenAiCompatibleImageEndpoint,
  resolveOpenAiCompatibleImageEditEndpoint,
  generateOpenAiCompatibleImages,
  editOpenAiCompatibleImages,
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

describe("openai-compatible image edits", () => {
  it("resolves edits endpoint from base and generations URLs", () => {
    expect(
      resolveOpenAiCompatibleImageEditEndpoint("https://image.codesonline.dev/v1"),
    ).toBe("https://image.codesonline.dev/v1/images/edits");
    expect(
      resolveOpenAiCompatibleImageEditEndpoint(
        "https://image.codesonline.dev/v1/images/generations",
      ),
    ).toBe("https://image.codesonline.dev/v1/images/edits");
    expect(
      resolveOpenAiCompatibleImageEditEndpoint(
        "https://image.codesonline.dev/v1/images/edits",
      ),
    ).toBe("https://image.codesonline.dev/v1/images/edits");
  });

  it("rejects dedicated text2image endpoints without falling back", () => {
    expect(() =>
      resolveOpenAiCompatibleImageEditEndpoint(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
      ),
    ).toThrow(/不支持图生图/);
    try {
      resolveOpenAiCompatibleImageEditEndpoint(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
      );
    } catch (error) {
      expect(error).toMatchObject({ code: "IMAGE_EDIT_NOT_SUPPORTED" });
    }
  });

  it("posts multipart /images/edits with image + image[] and numbered prompt", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const png2 = Buffer.from(png);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://image.codesonline.dev/v1/images/edits");
      expect(init?.method).toBe("POST");
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(String(form.get("prompt"))).toContain("第1张至第2张");
      expect(String(form.get("prompt"))).toContain("保留第1张的人脸");
      expect(form.get("n")).toBe("2");
      expect(form.get("quality")).toBe("high");
      expect(form.get("size")).toBe("16:9");
      expect(form.get("upscale")).toBe("4k");
      expect(form.get("model")).toBe("gpt-image-2");
      expect(form.get("aspect_ratio")).toBeNull();
      expect(form.get("resolution")).toBeNull();
      const image = form.get("image");
      expect(image).toBeInstanceOf(Blob);
      const imageBuf = Buffer.from(await (image as Blob).arrayBuffer());
      expect(imageBuf.equals(png)).toBe(true);
      const extras = form.getAll("image[]");
      expect(extras).toHaveLength(1);
      const extraBuf = Buffer.from(await (extras[0] as Blob).arrayBuffer());
      expect(extraBuf.equals(png2)).toBe(true);
      return Response.json({
        data: [
          { b64_json: Buffer.from("out1").toString("base64") },
          { b64_json: Buffer.from("out2").toString("base64") },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await editOpenAiCompatibleImages({
      endpoint: "https://image.codesonline.dev/v1",
      apiKey: "k",
      model: "gpt-image-2",
      prompt: "保留第1张的人脸",
      aspectRatio: "16:9",
      resolution: "4K",
      quality: "high",
      count: 2,
      images: [
        { buffer: png, mimeType: "image/png", fileName: "ref1.png" },
        { buffer: png2, mimeType: "image/png", fileName: "ref2.png" },
      ],
    });

    expect(result.images).toHaveLength(2);
    expect(result.images[0]?.buffer.toString()).toBe("out1");
    vi.unstubAllGlobals();
  });

  it("keeps /images/edits endpoint when switching models and surfaces model_not_allowed", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const models = [
      "gpt-image-2",
      "gpt-image-2-adobe",
      "gemini-banana-2.0-pro",
    ] as const;

    for (const model of models) {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("https://image.codesonline.dev/v1/images/edits");
        const form = init?.body as FormData;
        expect(form.get("model")).toBe(model);
        expect(form.get("image")).toBeInstanceOf(Blob);
        expect(form.getAll("image[]")).toHaveLength(0);
        return Response.json({
          data: [{ b64_json: Buffer.from("ok").toString("base64") }],
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      await editOpenAiCompatibleImages({
        endpoint: "https://image.codesonline.dev/v1",
        apiKey: "k",
        model,
        prompt: "改一下",
        images: [{ buffer: png, mimeType: "image/png", fileName: "a.png" }],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }

    const denied = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "model_not_allowed",
            message: "model not allowed",
          },
        },
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", denied);
    await expect(
      editOpenAiCompatibleImages({
        endpoint: "https://image.codesonline.dev/v1",
        apiKey: "k",
        model: "gemini-banana-2.0-pro",
        prompt: "改一下",
        images: [{ buffer: png, mimeType: "image/png", fileName: "a.png" }],
      }),
    ).rejects.toThrow(
      "当前 API Key 无权调用模型：gemini-banana-2.0-pro，请更换模型或联系管理员配置权限。",
    );
    expect(denied).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
