import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";

describe("personal materials + look reference sources", () => {
  let tempRoot: string;
  let previousDataRoot: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "ic-personal-mats-"));
    previousDataRoot = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = tempRoot;
  });

  afterEach(() => {
    if (previousDataRoot === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousDataRoot;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("cites system material into personal space idempotently", async () => {
    const { saveMaterialMedia } = await import("@/materials/media-store");
    const { createMaterial, softDeleteMaterial } = await import(
      "@/materials/catalog-store"
    );
    const {
      citeMaterialForUser,
      getPersonalMaterialForUser,
      listPersonalMaterials,
    } = await import("@/materials/citation-store");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const saved = await saveMaterialMedia({
      buffer: png,
      declaredMime: "image/png",
    });
    const material = await createMaterial(
      {
        name: "测试衣服",
        type: "clothing",
        mediaId: saved.mediaId,
        genderTags: ["female"],
        themeTags: ["modern"],
      },
      "admin",
    );

    const first = await citeMaterialForUser({
      userId: "user-a",
      materialId: material.id,
    });
    expect(first.alreadyCited).toBe(false);
    expect(first.personalMaterial.sourceType).toBe("system-citation");
    expect(first.personalMaterial.sourceMaterialId).toBe(material.id);

    const second = await citeMaterialForUser({
      userId: "user-a",
      materialId: material.id,
    });
    expect(second.alreadyCited).toBe(true);
    expect(second.personalMaterial.id).toBe(first.personalMaterial.id);

    const listed = await listPersonalMaterials("user-a");
    expect(listed).toHaveLength(1);

    await softDeleteMaterial(material.id);
    const still = await getPersonalMaterialForUser({
      userId: "user-a",
      personalMaterialId: first.personalMaterial.id,
    });
    expect(still?.mediaId).toBe(saved.mediaId);
    expect(still?.name).toBe("测试衣服");
  });

  it("creates upload personal materials", async () => {
    const { saveMaterialMedia } = await import("@/materials/media-store");
    const { createPersonalMaterial, listPersonalMaterials } = await import(
      "@/materials/citation-store"
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const saved = await saveMaterialMedia({
      buffer: png,
      declaredMime: "image/png",
    });
    const created = await createPersonalMaterial({
      userId: "user-b",
      material: {
        name: "本机参考",
        type: "character",
        mediaId: saved.mediaId,
        sourceType: "upload",
      },
    });
    expect(created.sourceType).toBe("upload");
    const listed = await listPersonalMaterials("user-b");
    expect(listed.map((m) => m.id)).toContain(created.id);
  });

  it("parses look referenceSources without trusting client media ids for materials", async () => {
    const { parseLookReferenceSourcesField } = await import(
      "@/materials/resolve-look-reference-sources"
    );
    const parsed = parseLookReferenceSourcesField(
      JSON.stringify([
        {
          slot: 0,
          sourceType: "personal-material",
          personalMaterialId: "pm-1",
        },
        { slot: 1, sourceType: "system-material", materialId: "sys-1" },
        {
          slot: 2,
          sourceType: "project-asset",
          mediaId: "proj-media",
        },
      ]),
    );
    expect(parsed).toEqual([
      {
        slot: 0,
        sourceType: "personal-material",
        personalMaterialId: "pm-1",
      },
      { slot: 1, sourceType: "system-material", materialId: "sys-1" },
      { slot: 2, sourceType: "project-asset", mediaId: "proj-media" },
    ]);
  });
});
