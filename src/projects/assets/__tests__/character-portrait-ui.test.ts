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
    expect(detail).toContain("基础信息");
    expect(detail).toContain("年龄");
    expect(detail).toContain("性别");
    expect(detail).toContain("hidePreview");
    expect(detail).toContain("character-hero-image");
    expect(detail).toContain("amw-image-preview--character-hero");
  });

  it("library cards are image-first with centered name", () => {
    expect(list).toContain("amw-char-grid");
    expect(list).toContain("amw-char-card__name");
    expect(list).not.toContain("asset-card__description");
    expect(list).not.toContain("amw-card__sub");
    expect(css).toContain(".amw-char-card__media");
    expect(css).toMatch(/object-fit:\s*contain/);
  });

  it("design character cards use portrait layout without side description", () => {
    expect(design).toContain("ead-card--character-portrait");
    expect(design).toContain("ead-card__name--center");
    expect(upload).toContain("hidePreview");
  });
});
