import { describe, expect, it } from "vitest";
import { queryMarketAssets } from "@/asset-market/queries";
import type { Material } from "@/materials/types";

function material(partial: Partial<Material> & Pick<Material, "id" | "name" | "type">): Material {
  return {
    mediaId: "media-1",
    description: "",
    tags: [],
    genderTags: [],
    themeTags: [],
    sortOrder: 0,
    status: "active",
    citeCount: 0,
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...partial,
  };
}

describe("asset market queries", () => {
  const materials = [
    material({ id: "c1", name: "角色A", type: "character", citeCount: 3 }),
    material({ id: "s1", name: "场景A", type: "scene" }),
    material({ id: "p1", name: "道具A", type: "prop" }),
    material({ id: "cloth", name: "衣服", type: "clothing" }),
    material({ id: "hidden", name: "下架", type: "character", status: "deleted" }),
  ];

  it("filters to market categories and published items", () => {
    const result = queryMarketAssets({
      materials,
      query: { category: "character" },
    });
    expect(result.items.map((item) => item.id)).toEqual(["c1"]);
    expect(result.total).toBe(1);
  });

  it("includes clothing in the clothing category", () => {
    const result = queryMarketAssets({
      materials,
      query: { category: "clothing" },
    });
    expect(result.items.map((item) => item.id)).toEqual(["cloth"]);
    expect(result.categoryCounts.clothing).toBe(1);
  });

  it("paginates with cursor", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      material({
        id: `c${index + 1}`,
        name: String(index + 1),
        type: "character",
        createdAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const page1 = queryMarketAssets({
      materials: many,
      query: { category: "character", limit: 24, sort: "latest" },
    });
    expect(page1.items).toHaveLength(24);
    expect(page1.nextCursor).toBe("c2");

    const page2 = queryMarketAssets({
      materials: many,
      query: {
        category: "character",
        limit: 24,
        sort: "latest",
        cursor: page1.nextCursor,
      },
    });
    expect(page2.items.map((item) => item.id)).toEqual(["c1"]);
  });
});
