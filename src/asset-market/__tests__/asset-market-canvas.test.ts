import { describe, expect, it } from "vitest";
import { materialToMarketAsset } from "@/asset-market/map-material";
import type { Material } from "@/materials/types";

const baseMaterial: Material = {
  id: "mat-1",
  name: "角色A",
  type: "character",
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
};

describe("add market asset to canvas mapping", () => {
  it("maps published character materials to market assets", () => {
    const asset = materialToMarketAsset(baseMaterial);
    expect(asset?.category).toBe("character");
    expect(asset?.status).toBe("published");
  });
});
