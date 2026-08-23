import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

const createLibraryPropWithImage = vi.fn(async () =>
  NextResponse.json({ prop: { id: "prop_x" } }, { status: 201 }),
);
const createLibraryCharacterWithImage = vi.fn(async () =>
  NextResponse.json({ character: { id: "char_x" } }, { status: 201 }),
);
const createLibrarySceneWithImage = vi.fn(async () =>
  NextResponse.json({ scene: { id: "scene_x" } }, { status: 201 }),
);
const writeProjectAssetImageFile = vi.fn(async () => undefined);
const loadAssetBundleDraft = vi.fn();
const saveAssetBundleDraft = vi.fn(async (bundle: unknown) => bundle);
const createCharacterAppearance = vi.fn(
  ({
    asset,
    name,
    currentMediaId,
  }: {
    asset: Record<string, unknown>;
    name?: string;
    currentMediaId?: string | null;
  }) => {
    const appearance = {
      id: "app_1",
      name: name ?? "造型",
      currentMediaId,
      promptOverride: "",
      mediaHistory: currentMediaId ? [currentMediaId] : [],
    };
    return {
      asset: {
        ...asset,
        appearances: [...((asset.appearances as unknown[]) ?? []), appearance],
      },
      appearance,
    };
  },
);

vi.mock("@/projects/assets/create-library-imageable-asset", () => ({
  createLibraryPropWithImage,
  createLibraryCharacterWithImage,
  createLibrarySceneWithImage,
}));

vi.mock("@/auth/require-access", () => ({
  requireProjectManagementProjectAccess: vi.fn(async () => ({
    ok: true as const,
    user: {
      id: "owner-1",
      username: "owner",
      role: "user" as const,
      displayName: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  })),
}));

vi.mock("@/projects/assets/asset-image-storage", () => ({
  isSafeProjectAssetImageId: () => true,
  writeProjectAssetImageFile,
}));

vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft,
  saveAssetBundleDraft,
}));

vi.mock("@/projects/assets/character-appearance-state", () => ({
  createCharacterAppearance,
}));

vi.mock("@/projects/assets/status", () => ({
  deriveCharacterStatus: () => "draft",
}));

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("materials clothing import", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-materials-clothing-"));
    process.env.APP_DATA_DIR = tmp;
    delete process.env.REMOTE_DATA_ONLY;
    createLibraryPropWithImage.mockClear();
    writeProjectAssetImageFile.mockClear();
    loadAssetBundleDraft.mockReset();
    saveAssetBundleDraft.mockClear();
    createCharacterAppearance.mockClear();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects clothing import without characterId and never creates a prop", async () => {
    const { createMaterial } = await import("@/materials/catalog-store");
    const { saveMaterialMedia } = await import("@/materials/media-store");
    const { importMaterialToProject } = await import(
      "@/materials/import-to-project",
    );

    const saved = await saveMaterialMedia({
      buffer: TINY_PNG,
      declaredMime: "image/png",
    });
    const material = await createMaterial(
      {
        name: "唐装外套",
        type: "clothing",
        mediaId: saved.mediaId,
        genderTags: ["male"],
        themeTags: ["ancient"],
      },
      "admin",
    );

    const res = await importMaterialToProject({
      userId: "owner-1",
      materialId: material.id,
      projectId: "proj-1",
      characterId: null,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("CLOTHING_REQUIRES_CHARACTER");
    expect(createLibraryPropWithImage).not.toHaveBeenCalled();
  });

  it("imports clothing as character look, not prop", async () => {
    const { createMaterial } = await import("@/materials/catalog-store");
    const { saveMaterialMedia } = await import("@/materials/media-store");
    const { importMaterialToProject } = await import(
      "@/materials/import-to-project",
    );

    const saved = await saveMaterialMedia({
      buffer: TINY_PNG,
      declaredMime: "image/png",
    });
    const material = await createMaterial(
      {
        name: "旗袍",
        type: "clothing",
        mediaId: saved.mediaId,
        genderTags: ["female"],
        themeTags: ["ancient"],
      },
      "admin",
    );

    loadAssetBundleDraft.mockResolvedValue({
      projectId: "proj-1",
      characters: [
        {
          id: "char-1",
          projectId: "proj-1",
          name: "林晚",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
          appearances: [],
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    const res = await importMaterialToProject({
      userId: "owner-1",
      materialId: material.id,
      projectId: "proj-1",
      characterId: "char-1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created?: { kind?: string; sourceMaterialId?: string };
    };
    expect(body.created?.kind).toBe("clothing-look");
    expect(body.created?.sourceMaterialId).toBe(material.id);
    expect(createLibraryPropWithImage).not.toHaveBeenCalled();
    expect(writeProjectAssetImageFile).toHaveBeenCalled();
    expect(createCharacterAppearance).toHaveBeenCalled();
    expect(saveAssetBundleDraft).toHaveBeenCalled();
  });
});
