import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("Batch H1 design asset card UI contract", () => {
  const workspace = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );
  const modal = readSrc("src/projects/assets/DesignAssetModal.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");

  it("DesignItemCard exposes design action and asset type icons", () => {
    expect(workspace).toContain("function DesignItemCard");
    expect(workspace).toContain("设计");
    expect(workspace).toContain('data-testid={`ead-design-${item.id}`}');
    expect(workspace).toContain("UserRound");
    expect(workspace).toContain("MapPinned");
    expect(workspace).toContain("Package");
    expect(workspace).toContain("ead-card--visual-asset");
    expect(workspace).toContain("ead-card--character");
    expect(workspace).not.toContain("ead-card--character-portrait");
  });

  it("DesignAssetModal wired with copy and generate actions", () => {
    expect(workspace).toContain("DesignAssetModal");
    expect(workspace).toContain("designModalItem");
    expect(workspace).toContain('"/workspace/"');
    expect(modal).toContain("一键复制");
    expect(modal).toContain("生成资产");
    expect(modal).toContain("输入素材要求");
    expect(modal).toContain("ead-requirement-dialog");
    expect(modal).toContain("ead-modal");
    expect(modal).toContain("design-image-preview");
    expect(modal).toContain("design-download");
    expect(modal).toContain("DesignImageLightbox");
    expect(modal).toContain("点击放大");
  });

  it("includes card and modal layout styles", () => {
    expect(css).toContain(".ead-card__layout");
    expect(css).toContain(".ead-card--visual-asset");
    expect(css).toContain(".ead-card--character");
    expect(css).not.toContain(".ead-card--character-portrait");
    expect(css).toContain(".asset-compact-list");
    expect(css).toContain(".ead-modal-backdrop");
    expect(css).toContain(".ead-card__design-btn");
  });
});
