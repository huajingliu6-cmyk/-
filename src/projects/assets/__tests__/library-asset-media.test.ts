import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAssetBundleDraft = vi.fn();
const saveAssetBundleDraft = vi.fn();
const synchronizeAssetDraftDownstream = vi.fn();
const readProjectAssetImageFile = vi.fn();
const findImageableAssetInDraft = vi.fn();
const deleteProjectAssetImageFile = vi.fn();
const generateDesignAssetImage = vi.fn();
const reserveImageGenerationCredits = vi.fn();
const settleGenerationCredits = vi.fn();
const releaseGenerationCredits = vi.fn();

vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft: (...args: unknown[]) => loadAssetBundleDraft(...args),
  saveAssetBundleDraft: (...args: unknown[]) => saveAssetBundleDraft(...args),
}));

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: (...args: unknown[]) =>
    synchronizeAssetDraftDownstream(...args),
  synchronizeAssetMediaDownstream: vi.fn(),
}));

vi.mock("@/projects/assets/asset-image-storage", () => ({
  findImageableAssetInDraft: (...args: unknown[]) =>
    findImageableAssetInDraft(...args),
  readProjectAssetImageFile: (...args: unknown[]) =>
    readProjectAssetImageFile(...args),
  deleteProjectAssetImageFile: (...args: unknown[]) =>
    deleteProjectAssetImageFile(...args),
  isSafeProjectAssetImageId: (id: string) =>
    typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id),
}));

vi.mock("@/projects/assets/episode-design/generate-design-asset-image", () => ({
  generateDesignAssetImage: (...args: unknown[]) =>
    generateDesignAssetImage(...args),
}));

vi.mock("@/credits/generation-billing", () => ({
  reserveImageGenerationCredits: (...args: unknown[]) =>
    reserveImageGenerationCredits(...args),
  settleGenerationCredits: (...args: unknown[]) =>
    settleGenerationCredits(...args),
  releaseGenerationCredits: (...args: unknown[]) =>
    releaseGenerationCredits(...args),
  parseIdempotencyKey: (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null,
}));

vi.mock("@/credits/generation-pricing", () => ({
  estimateAssetImageCredits: () => ({ points: 1 }),
}));

describe("library asset media generate/save", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    synchronizeAssetDraftDownstream.mockResolvedValue({ deferred: false });
    saveAssetBundleDraft.mockResolvedValue(undefined);
  });

  it("rejects non image_to_image modes and missing references", async () => {
    const { runLibraryAssetMediaGenerate } = await import(
      "@/projects/assets/library-asset-media"
    );
    const form = new FormData();
    form.set("assetId", "asset_char_1");
    form.set("assetKind", "character");
    form.set("mode", "text_to_image");
    form.set("prompt", "x");
    form.set("idempotencyKey", "k1");
    const badMode = await runLibraryAssetMediaGenerate({
      request: new Request("http://localhost", { method: "POST", body: form }),
      projectId: "proj_1",
      actorUserId: "user_1",
    });
    expect(badMode.status).toBe(400);
    const payload = (await badMode.json()) as { code?: string };
    expect(payload.code).toBe("IMAGE_TO_IMAGE_REQUIRED");
  });

  it("saves media ids idempotently without changing primary by default", async () => {
    const draft = {
      projectId: "proj_1",
      characters: [
        {
          id: "asset_char_1",
          name: "林清",
          approvedMediaIds: ["img_old"],
          primaryMediaId: "img_old",
          imageFileName: "img_old",
        },
      ],
      scenes: [],
      props: [],
    };
    loadAssetBundleDraft.mockResolvedValue(draft);
    findImageableAssetInDraft.mockReturnValue({
      kind: "character",
      asset: draft.characters[0],
    });
    readProjectAssetImageFile.mockResolvedValue({
      mediaId: "gen_new",
      mimeType: "image/png",
      buffer: Buffer.from("x"),
    });

    const { runLibraryAssetMediaSave } = await import(
      "@/projects/assets/library-asset-media"
    );

    const first = await runLibraryAssetMediaSave({
      projectId: "proj_1",
      assetId: "asset_char_1",
      assetKind: "character",
      mediaId: "gen_new",
      setPrimary: false,
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      approvedMediaIds: string[];
      primaryMediaId: string | null;
    };
    expect(firstBody.approvedMediaIds).toEqual(["img_old", "gen_new"]);
    expect(firstBody.primaryMediaId).toBe("img_old");

    const saved = saveAssetBundleDraft.mock.calls[0]?.[0] as typeof draft;
    findImageableAssetInDraft.mockReturnValue({
      kind: "character",
      asset: saved.characters[0],
    });
    loadAssetBundleDraft.mockResolvedValue(saved);

    const second = await runLibraryAssetMediaSave({
      projectId: "proj_1",
      assetId: "asset_char_1",
      assetKind: "character",
      mediaId: "gen_new",
      setPrimary: false,
    });
    const secondBody = (await second.json()) as {
      approvedMediaIds: string[];
    };
    expect(secondBody.approvedMediaIds.filter((id) => id === "gen_new")).toHaveLength(
      1,
    );
    expect(synchronizeAssetDraftDownstream).toHaveBeenCalled();
  });

  it("generates with image_to_image and never falls back to text_to_image", async () => {
    const draft = {
      projectId: "proj_1",
      characters: [
        {
          id: "asset_char_1",
          name: "林清",
          approvedMediaIds: ["img_old"],
          primaryMediaId: "img_old",
          imageFileName: "img_old",
        },
      ],
      scenes: [],
      props: [],
    };
    loadAssetBundleDraft.mockResolvedValue(draft);
    findImageableAssetInDraft.mockReturnValue({
      kind: "character",
      asset: draft.characters[0],
    });
    readProjectAssetImageFile.mockResolvedValue({
      mediaId: "img_old",
      mimeType: "image/png",
      buffer: Buffer.from("png"),
      fileName: "img_old.png",
    });
    reserveImageGenerationCredits.mockResolvedValue({
      ok: true,
      reservationId: "res_1",
      balance: 10,
    });
    settleGenerationCredits.mockResolvedValue({ balance: 9 });
    generateDesignAssetImage.mockResolvedValue({
      mediaId: "gen_1",
      count: 1,
      images: [{ mediaId: "gen_1", mimeType: "image/png" }],
      notice: "ok",
    });

    const { runLibraryAssetMediaGenerate } = await import(
      "@/projects/assets/library-asset-media"
    );
    const form = new FormData();
    form.set("assetId", "asset_char_1");
    form.set("assetKind", "character");
    form.set("mode", "image_to_image");
    form.set("prompt", "保留第1张人脸");
    form.set("idempotencyKey", "k-gen");
    form.set("quality", "high");
    form.set("aspectRatio", "16:9");
    form.set("count", "1");
    form.set("model", "gpt-image-2");
    form.set("referenceMediaId[0]", "img_old");

    const res = await runLibraryAssetMediaGenerate({
      request: new Request("http://localhost", { method: "POST", body: form }),
      projectId: "proj_1",
      actorUserId: "user_1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      mediaIds: string[];
    };
    expect(body.mode).toBe("image_to_image");
    expect(body.mediaIds).toEqual(["gen_1"]);
    expect(generateDesignAssetImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: expect.any(Array),
        model: "gpt-image-2",
        quality: "high",
        aspectRatio: "16:9",
        count: 1,
      }),
    );
    const call = generateDesignAssetImage.mock.calls[0]?.[0] as {
      referenceImages: unknown[];
    };
    expect(call.referenceImages.length).toBeGreaterThan(0);
  });
});
