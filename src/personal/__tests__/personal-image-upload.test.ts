import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAcceptedImageFile } from "@/personal/accepted-image-file";
import { createReferenceImage, mergeReferenceFiles } from "@/personal/ui/personal-image-utils";

describe("accepted image files", () => {
  it("accepts common mime types and extensions when type is empty", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "ref.png", {
      type: "",
    });
    const jpg = new File([new Uint8Array([1, 2, 3])], "ref.JPG", {
      type: "",
    });
    expect(isAcceptedImageFile(png)).toBe(true);
    expect(isAcceptedImageFile(jpg)).toBe(true);
    expect(isAcceptedImageFile(new File([new Uint8Array([1])], "doc.txt"))).toBe(
      false,
    );
  });
});

describe("personal reference thumbnails on HTTP LAN", () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  });

  it("creates reference previews when crypto.randomUUID is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(bytes: Uint8Array) {
          for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 3;
          return bytes;
        },
      },
    });

    const file = new File([new Uint8Array([1, 2, 3])], "ref.jpg", { type: "" });
    expect(isAcceptedImageFile(file)).toBe(true);

    const created = createReferenceImage(file);
    expect(created.id).toMatch(/^ref_/);
    expect(created.previewUrl).toMatch(/^blob:/);

    const merged = mergeReferenceFiles([], [file], 6);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.previewUrl).toMatch(/^blob:/);
  });

  it("merges multiple incoming files up to the max", () => {
    const files = [1, 2, 3].map(
      (index) =>
        new File([new Uint8Array([index])], `ref-${index}.png`, {
          type: "image/png",
        }),
    );
    const merged = mergeReferenceFiles([], files, 6);
    expect(merged).toHaveLength(3);
  });

  it("stops merging when max references is reached", () => {
    const existing = mergeReferenceFiles(
      [],
      [
        new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
        new File([new Uint8Array([2])], "b.png", { type: "image/png" }),
      ],
      2,
    );
    const merged = mergeReferenceFiles(
      existing,
      [new File([new Uint8Array([3])], "c.png", { type: "image/png" })],
      2,
    );
    expect(merged).toHaveLength(2);
  });
});

describe("personal image upload to personal assets", () => {
  let tempRoot: string;
  let previousDataRoot: string | undefined;

  beforeEach(async () => {
    const { mkdtempSync } = await import("fs");
    const os = await import("os");
    const path = await import("path");
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "ic-personal-upload-"));
    previousDataRoot = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = tempRoot;
    delete process.env.REMOTE_DATA_ONLY;
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    const { rmSync } = await import("fs");
    if (previousDataRoot === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousDataRoot;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("imports generated image history into personal assets with copied media", async () => {
    const { saveMaterialMedia } = await import("@/materials/media-store");
    const { personalImageMediaUrl } = await import(
      "@/personal/image-generation/constants"
    );
    const { prependPersonalImageHistory } = await import(
      "@/personal/image-generation/store"
    );
    const { importPersonalImageHistoryToAssets } = await import(
      "@/personal/image-generation/import-to-personal-assets"
    );
    const { listPersonalAssets } = await import("@/personal-assets/store");
    const { readPersonalAssetMedia } = await import("@/personal-assets/media");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const saved = await saveMaterialMedia({
      buffer: png,
      declaredMime: "image/png",
    });
    const historyItem = {
      id: "pimg_test_upload",
      imageUrl: personalImageMediaUrl(saved.mediaId),
      name: "测试入库",
      prompt: "测试提示词",
      aspectRatio: "16:9",
      resolution: "1K" as const,
      modelId: "gpt-image-2",
      count: 1 as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      uploadedToPersonalAssets: false,
    };
    await prependPersonalImageHistory("user-upload", [historyItem]);

    const imported = await importPersonalImageHistoryToAssets({
      userId: "user-upload",
      itemId: historyItem.id,
    });
    expect(imported.created).toBe(true);
    expect(imported.item.uploadedToPersonalAssets).toBe(true);
    expect(imported.item.personalAssetId).toBe(imported.asset.id);

    const listed = await listPersonalAssets("user-upload");
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.name).toBe("测试入库");
    expect(listed.items[0]?.sourceType).toBe("ai_image");
    expect(listed.items[0]?.storageKey).not.toBe(
      `materials/blobs/${saved.mediaId}`,
    );

    const media = await readPersonalAssetMedia(listed.items[0]!.storageKey);
    expect(media?.body.length).toBe(png.length);

    const again = await importPersonalImageHistoryToAssets({
      userId: "user-upload",
      itemId: historyItem.id,
    });
    expect(again.created).toBe(false);
    expect(again.asset.id).toBe(imported.asset.id);
    expect((await listPersonalAssets("user-upload")).items).toHaveLength(1);
  });

  it("re-imports when history is marked uploaded but personal asset is missing", async () => {
    const { saveMaterialMedia } = await import("@/materials/media-store");
    const { personalImageMediaUrl } = await import(
      "@/personal/image-generation/constants"
    );
    const { prependPersonalImageHistory } = await import(
      "@/personal/image-generation/store"
    );
    const { importPersonalImageHistoryToAssets } = await import(
      "@/personal/image-generation/import-to-personal-assets"
    );
    const { listPersonalAssets } = await import("@/personal-assets/store");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const saved = await saveMaterialMedia({
      buffer: png,
      declaredMime: "image/png",
    });
    const historyItem = {
      id: "pimg_stale_flag",
      imageUrl: personalImageMediaUrl(saved.mediaId),
      name: "恢复入库",
      prompt: "恢复测试",
      aspectRatio: "16:9",
      resolution: "1K" as const,
      modelId: "gpt-image-2",
      count: 1 as const,
      generatedAt: "2026-01-02T00:00:00.000Z",
      uploadedToPersonalAssets: true,
    };
    await prependPersonalImageHistory("user-stale", [historyItem]);

    const imported = await importPersonalImageHistoryToAssets({
      userId: "user-stale",
      itemId: historyItem.id,
    });
    expect(imported.created).toBe(true);
    expect((await listPersonalAssets("user-stale")).items).toHaveLength(1);
  });
});
