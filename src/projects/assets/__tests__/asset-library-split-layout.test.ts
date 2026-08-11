import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset library three-pane workspace contracts", () => {
  const detail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const list = readSrc("src/projects/assets/CharacterList.tsx");
  const scene = readSrc("src/projects/assets/SceneManager.tsx");
  const prop = readSrc("src/projects/assets/PropManager.tsx");
  const layout = readSrc("src/projects/assets/AssetLibraryLayout.tsx");
  const detailLayout = readSrc("src/projects/assets/AssetDetailLayout.tsx");
  const voiceSelector = readSrc("src/projects/assets/VoiceSelector.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");

  it("uses three-pane workspace shells", () => {
    expect(layout).toContain("asset-library-workspace");
    expect(layout).toContain("asset-library-list");
    expect(layout).toContain("asset-library-list__items");
    expect(layout).toContain("asset-library__details");
    expect(detailLayout).toContain("asset-library-preview");
    expect(detailLayout).toContain("asset-library-controls");
    expect(detailLayout).toContain("asset-controls__voice");
    expect(css).toMatch(
      /\.asset-library-workspace[\s\S]*?280px/,
    );
    expect(css).toContain(".asset-library-preview");
    expect(css).toContain(".asset-library-controls");
  });

  it("character detail is mid-preview + right controls with compact fields", () => {
    expect(detail).toContain("AssetDetailLayout");
    expect(detail).toContain("AssetBasicInfo");
    expect(detail).toContain("compact");
    expect(detail).toContain("AssetDetailImage");
    expect(detail).toContain("fill");
    expect(detail).toContain('label: "定位"');
    expect(detail).toContain('label: "性别"');
    expect(detail).toContain('label: "年龄"');
    expect(detail).toContain("character-hero-image");
    expect(detail).toContain("asset-controls__voice");
    expect(detail).toContain("VoiceSelector");
    expect(detail).toContain("VoicePreviewButton");
    expect(detail).not.toContain("视觉设定");
    expect(voiceSelector).toContain("menuPortal");
    expect(css).toContain(".asset-controls__basic-grid");
    expect(css).toMatch(/object-fit:\s*contain/);
    expect(css).toContain(".asset-controls__notes-textarea");
  });

  it("character list is compact sidebar rows", () => {
    expect(list).toContain("AssetCompactList");
    expect(list).toContain("character-card-grid");
    expect(list).not.toContain("amw-char-card__media");
    expect(css).toContain(".asset-compact-list__thumb");
    expect(css).toMatch(/flex:\s*0\s*0\s*48px|width:\s*48px/);
  });

  it("scene and prop reuse mid+right layout without voice", () => {
    expect(scene).toContain("AssetLibraryLayout");
    expect(scene).toContain("AssetDetailLayout");
    expect(scene).toContain("AssetBasicInfo");
    expect(scene).toContain("AssetDetailImage");
    expect(scene).toContain("preview=");
    expect(scene).toContain("compact");
    expect(scene).not.toContain("VoiceSelector");
    expect(scene).not.toContain('label: "性别"');
    expect(scene).not.toContain('label: "年龄"');
    expect(prop).toContain("AssetLibraryLayout");
    expect(prop).toContain("AssetDetailLayout");
    expect(prop).toContain("preview=");
    expect(prop).not.toContain("VoiceSelector");
    expect(prop).not.toContain('label: "性别"');
    expect(prop).not.toContain('label: "年龄"');
  });
});
