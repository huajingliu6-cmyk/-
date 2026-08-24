import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset market shell contracts", () => {
  it("exposes sidebar nav below personal assets", () => {
    const sidebar = readSrc("src/shell/AppSidebar.tsx");
    const nav = readSrc("src/shell/nav.ts");
    expect(sidebar).toContain("素材市场");
    expect(sidebar).toContain("app-sidebar-asset-market");
    expect(sidebar).toContain("画布");
    expect(sidebar).toContain("app-sidebar-canvas");
    expect(sidebar).toContain("LayoutGrid");
    expect(nav).toContain('label: "素材市场"');
    expect(nav).toContain('href: APP_ASSET_MARKET_PATH');

    const personalIdx = sidebar.indexOf('label: "个人素材"');
    const marketIdx = sidebar.indexOf('label: "素材市场"');
    const canvasIdx = sidebar.indexOf('label: "画布"');
    expect(personalIdx).toBeGreaterThan(-1);
    expect(marketIdx).toBeGreaterThan(personalIdx);
    expect(canvasIdx).toBeGreaterThan(marketIdx);
  });

  it("renders browse-first asset market grid without admin controls", () => {
    const page = readSrc("src/asset-market/ui/AssetMarketPage.tsx");
    const constants = readSrc("src/asset-market/constants.ts");
    expect(page).toContain("asset-market-page__grid");
    expect(page).toContain("asset-market-drawer");
    expect(page).not.toContain("AssetLibraryLayout");
    expect(page).not.toContain("admin/materials");
    expect(page).not.toContain("管理素材");
    expect(page).not.toContain("上传素材");
    expect(page).not.toContain("角色管理");
    expect(page).not.toContain("场景管理");
    expect(page).not.toContain("道具管理");
    expect(page).toContain("添加到个人素材");
    expect(page).toContain("添加到当前项目");
    expect(page).toContain("/api/asset-market");
    expect(constants).toContain("角色形象");
    expect(constants).toContain("衣服商城");
    expect(constants).toContain("常用场景");
    expect(constants).toContain("常用道具");
  });

  it("redirects legacy enterprise assets route", () => {
    const legacy = readSrc("src/app/app/enterprise-assets/page.tsx");
    expect(legacy).toContain("APP_ASSET_MARKET_PATH");
    expect(legacy).toContain("redirect");
  });
});
