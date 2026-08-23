import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  resolveLocalPath: vi.fn(() => {
    throw new Error("LOCAL_PERSISTENCE_FORBIDDEN");
  }),
  getRemoteImage: vi.fn(),
}));

vi.mock("@/auth/require-access", () => ({
  requireProjectManagementProjectAccess: vi.fn(async () => ({ ok: true })),
  requireWorkspaceAssetAccess: vi.fn(async () => ({ ok: false })),
}));

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  isRemoteDataServiceError: () => false,
}));

vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft: vi.fn(),
}));

vi.mock("@/projects/assets/asset-image-storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/assets/asset-image-storage")>();
  return {
    ...actual,
    PROJECT_ASSET_IMAGE_MAX_BYTES: 10 * 1024 * 1024,
    assetImageMetaPath: vi.fn(),
    deleteProjectAssetImageFile: vi.fn(),
    findImageableAssetInDraft: vi.fn(),
    normalizeDeclaredImageMime: vi.fn(),
    patchImageableAssetImageMeta: vi.fn(),
    resolveAssetImageFilePath: storage.resolveLocalPath,
    sniffProjectAssetImageMime: vi.fn(),
    writeProjectAssetImageFile: vi.fn(),
  };
});

vi.mock("@/projects/assets/remote-asset-blob-store", () => ({
  deleteRemoteAssetImage: vi.fn(),
  getRemoteAssetImage: storage.getRemoteImage,
  putRemoteAssetImage: vi.fn(),
}));

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetMediaDownstream: vi.fn(),
}));

vi.mock("@/video-generation/ark-image-safety-precheck", () => ({
  runAndPersistAssetVideoRefPrecheck: vi.fn(),
}));

import { GET } from "@/app/api/projects/[projectId]/assets-draft/images/[assetId]/route";

describe("remote asset image route", () => {
  beforeEach(() => {
    storage.resolveLocalPath.mockClear();
    storage.getRemoteImage.mockReset();
  });

  it("reads generated images without resolving a forbidden local path", async () => {
    const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    storage.getRemoteImage.mockResolvedValue({
      body: expected,
      contentType: "image/png",
      etag: null,
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({
        projectId: "p_remote",
        assetId: "gen_preview",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
    expect(storage.getRemoteImage).toHaveBeenCalledWith(
      "p_remote",
      "gen_preview",
    );
    expect(storage.resolveLocalPath).not.toHaveBeenCalled();
  });
});
