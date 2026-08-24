import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { queryPersonalAssets } from "@/personal-assets/queries";
import { readImageDimensions } from "@/personal-assets/image-dimensions";
import type { PersonalAsset } from "@/personal-assets/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function makeAsset(overrides: Partial<PersonalAsset> = {}): PersonalAsset {
  return {
    id: overrides.id ?? "asset-1",
    ownerId: "user-1",
    name: overrides.name ?? "测试素材",
    category: overrides.category ?? "other",
    mimeType: "image/png",
    sizeBytes: overrides.sizeBytes ?? 1024,
    width: 100,
    height: 100,
    storageKey: "materials/blobs/abc",
    sourceType: "manual_upload",
    createdAt: overrides.createdAt ?? "2026-01-02T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("personal assets module", () => {
  it("filters, sorts and paginates assets", () => {
    const assets = [
      makeAsset({ id: "a", name: "角色A", category: "character", createdAt: "2026-01-03T00:00:00.000Z" }),
      makeAsset({ id: "b", name: "场景B", category: "scene", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeAsset({ id: "c", name: "道具C", category: "prop", createdAt: "2026-01-02T00:00:00.000Z" }),
    ];

    const recent = queryPersonalAssets(assets, { limit: 2 });
    expect(recent.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(recent.nextCursor).toBe("c");
    expect(recent.categoryCounts.character).toBe(1);

    const sceneOnly = queryPersonalAssets(assets, { category: "scene", sort: "name" });
    expect(sceneOnly.items).toHaveLength(1);
    expect(sceneOnly.items[0]?.name).toBe("场景B");
  });

  it("reads png dimensions from buffer header", () => {
    const buffer = Buffer.alloc(24);
    buffer[0] = 0x89;
    buffer[1] = 0x50;
    buffer[2] = 0x4e;
    buffer[3] = 0x47;
    buffer.writeUInt32BE(640, 16);
    buffer.writeUInt32BE(360, 20);
    expect(readImageDimensions(buffer)).toEqual({ width: 640, height: 360 });
  });

  it("exposes personal assets page route and UI contract", () => {
    const page = readSrc("src/personal-assets/ui/PersonalAssetsPage.tsx");
    const route = readSrc("src/app/app/personal-assets/page.tsx");
    const nav = readSrc("src/shell/nav.ts");

    expect(route).toContain("PersonalAssetsShell");
    expect(nav).toContain("/app/personal-assets");
    expect(page).toContain("personal-assets-upload-panel");
    expect(page).toContain("personal-assets-preview");
    expect(page).toContain("personal-assets-batch-bar");
    expect(page).toContain("释放以上传");
  });
});
