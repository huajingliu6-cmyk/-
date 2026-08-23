import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  filterAndSortMaterials,
  hasRequiredFilterTags,
  materialMatchesQuery,
} from "@/materials/filters";
import type { Material } from "@/materials/types";

function material(partial: Partial<Material> & Pick<Material, "id" | "name">): Material {
  return {
    id: partial.id,
    name: partial.name,
    type: partial.type ?? "clothing",
    mediaId: partial.mediaId ?? "media1",
    description: partial.description ?? "",
    tags: partial.tags ?? [],
    genderTags: partial.genderTags ?? ["unrestricted"],
    themeTags: partial.themeTags ?? ["unrestricted"],
    sortOrder: partial.sortOrder ?? 1,
    status: partial.status ?? "active",
    citeCount: partial.citeCount ?? 0,
    createdBy: partial.createdBy ?? "admin",
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("materials filters", () => {
  it("supports multi-select gender and theme filters (OR within each)", () => {
    const items = [
      material({
        id: "1",
        name: "男装古装",
        genderTags: ["male"],
        themeTags: ["ancient"],
      }),
      material({
        id: "2",
        name: "女装现代",
        genderTags: ["female"],
        themeTags: ["modern"],
      }),
      material({
        id: "3",
        name: "不限主题童装",
        genderTags: ["child"],
        themeTags: ["unrestricted"],
      }),
      material({
        id: "4",
        name: "道具",
        type: "prop",
        genderTags: ["child"],
        themeTags: ["sport"],
      }),
    ];

    const filtered = filterAndSortMaterials(items, {
      genders: ["male", "female"],
      themes: ["ancient", "modern"],
    });
    expect(filtered.map((item) => item.id).sort()).toEqual(["1", "2"]);

    // Theme "unrestricted" must not match unrelated theme filters.
    expect(
      materialMatchesQuery(items[2]!, {
        genders: ["child"],
        themes: ["formal"],
      }),
    ).toBe(false);

    expect(
      materialMatchesQuery(items[2]!, {
        genders: ["child"],
        themes: ["unrestricted"],
      }),
    ).toBe(true);

    // Material tagged only "unrestricted" must not appear under "male".
    expect(
      materialMatchesQuery(
        material({
          id: "u",
          name: "不限",
          genderTags: ["unrestricted"],
          themeTags: ["unrestricted"],
        }),
        { genders: ["male"] },
      ),
    ).toBe(false);
  });

  it("requires at least one gender or theme tag for upload metadata", () => {
    expect(hasRequiredFilterTags({ genderTags: [], themeTags: [] })).toBe(
      false,
    );
    expect(
      hasRequiredFilterTags({ genderTags: ["male"], themeTags: [] }),
    ).toBe(true);
    expect(
      hasRequiredFilterTags({ genderTags: [], themeTags: ["modern"] }),
    ).toBe(true);
    expect(
      hasRequiredFilterTags({
        genderTags: ["unrestricted"],
        themeTags: ["unrestricted"],
      }),
    ).toBe(true);
  });
});

describe("materials catalog + citation stores", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-materials-"));
    process.env.APP_DATA_DIR = tmp;
    delete process.env.REMOTE_DATA_ONLY;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects create when gender or theme tags are missing", async () => {
    const { createMaterial } = await import("@/materials/catalog-store");
    await expect(
      createMaterial(
        {
          name: "缺标签",
          type: "clothing",
          mediaId: "m1",
          genderTags: [],
          themeTags: [],
        },
        "admin",
      ),
    ).rejects.toThrow(/性别|主题/);
  });

  it("soft delete hides from list while citation snapshot stays readable", async () => {
    const { createMaterial, softDeleteMaterial, listMaterials, getMaterialById } =
      await import("@/materials/catalog-store");
    const { citeMaterialForUser, loadUserMaterialLibrary } = await import(
      "@/materials/citation-store"
    );

    const created = await createMaterial(
      {
        name: "可下架",
        type: "prop",
        mediaId: "media-soft",
        genderTags: ["unrestricted"],
        themeTags: ["unrestricted"],
      },
      "admin",
    );

    const cited = await citeMaterialForUser({
      userId: "user-1",
      materialId: created.id,
    });
    expect(cited.alreadyCited).toBe(false);

    await softDeleteMaterial(created.id);

    const listed = await listMaterials({});
    expect(listed.some((item) => item.id === created.id)).toBe(false);
    expect(await getMaterialById(created.id)).toBeNull();

    const library = await loadUserMaterialLibrary("user-1");
    const snap = library.citations.find((c) => c.materialId === created.id);
    expect(snap?.snapshot.name).toBe("可下架");
    expect(snap?.snapshot.mediaId).toBe("media-soft");
    expect(snap?.sourceMaterialId).toBe(created.id);
    expect(snap?.personalAssetId).toBeTruthy();
  });

  it("cite is idempotent and only increments once", async () => {
    const { createMaterial, getMaterialById } = await import(
      "@/materials/catalog-store"
    );
    const { citeMaterialForUser } = await import("@/materials/citation-store");

    const created = await createMaterial(
      {
        name: "引用一次",
        type: "scene",
        mediaId: "media-cite",
        genderTags: ["unrestricted"],
        themeTags: ["unrestricted"],
      },
      "admin",
    );

    const first = await citeMaterialForUser({
      userId: "user-2",
      materialId: created.id,
    });
    const second = await citeMaterialForUser({
      userId: "user-2",
      materialId: created.id,
    });

    expect(first.alreadyCited).toBe(false);
    expect(second.alreadyCited).toBe(true);
    expect(second.citation.personalAssetId).toBe(first.citation.personalAssetId);

    const after = await getMaterialById(created.id);
    expect(after?.citeCount).toBe(1);
  });
});
