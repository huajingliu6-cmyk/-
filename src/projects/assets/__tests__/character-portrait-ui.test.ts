import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("character asset portrait UI contracts", () => {
  const detail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const list = readSrc("src/projects/assets/CharacterList.tsx");
  const upload = readSrc("src/projects/assets/AssetImageUpload.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");
  const design = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );

  it("hides visual settings section and keeps a single hero image", () => {
    expect(detail).not.toContain("视觉设定");
    expect(detail).not.toContain("外貌描述");
    expect(detail).not.toContain("服装描述");
    expect(detail).toContain("AssetBasicInfo");
    expect(detail).toContain("年龄");
    expect(detail).toContain("性别");
    expect(detail).toContain("hidePreview");
    expect(detail).toContain("character-hero-image");
    expect(detail).toContain("AssetDetailImage");
    expect(readSrc("src/projects/assets/AssetBasicInfo.tsx")).toContain(
      "基础信息",
    );
  });

  it("library cards are compact list rows with independent scroll", () => {
    expect(list).toContain("AssetCompactList");
    expect(list).toContain("character-card-grid");
    expect(list).not.toContain("asset-card__description");
    expect(list).not.toContain("amw-card__sub");
    expect(css).toContain(".asset-library__list-scroll");
    expect(css).toMatch(/object-fit:\s*contain/);
  });

  it("design character cards restore side-by-side layout without portrait class", () => {
    expect(design).toContain("ead-card--character");
    expect(design).toContain("ead-card__layout");
    expect(design).not.toContain("ead-card--character-portrait");
    expect(design).toContain("ead-card--visual-asset");
    expect(upload).toContain("hidePreview");
  });
});
