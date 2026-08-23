import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("character prompt reference slots", () => {
  const modal = readSrc("src/projects/assets/DesignAssetModal.tsx");
  const detail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const list = readSrc("src/projects/assets/AssetCompactList.tsx");
  const slots = readSrc("src/projects/assets/CompactPromptReferenceSlots.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");

  it("shows three compact reference slots above character prompt", () => {
    expect(slots).toContain("LIBRARY_COMPACT_REFERENCE_SLOT_COUNT = 3");
    expect(modal).toContain("CompactPromptReferenceSlots");
    expect(modal).toContain("showLibraryCompactReferences");
    expect(modal).toContain(
      'form.set("mode", hasCompactRefs ? "image_to_image" : "text_to_image")',
    );
    expect(css).toContain(".character-prompt-reference-slots");
    expect(css).toMatch(
      /\.character-prompt-reference-slots[\s\S]*?grid-template-columns:\s*repeat\(3/,
    );
  });

  it("supports dragging project images into reference slots", () => {
    expect(detail).toContain("projectAssetMediaDragProps");
    expect(detail).toContain("buildProjectAssetMediaDragPayload");
    expect(list).toContain("projectAssetMediaDragProps");
    expect(slots).toContain("readProjectAssetMediaDrag");
    expect(slots).toContain("onDrop");
    expect(slots).toContain("个人素材");
    expect(slots).toContain("本地上传");
    expect(slots).toContain("MaterialPickerModal");
  });
});
