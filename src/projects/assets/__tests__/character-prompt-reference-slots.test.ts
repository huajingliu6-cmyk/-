import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  emptyCompactPromptReferenceSlots,
  filledCompactPromptReferenceSlotCount,
  LIBRARY_COMPACT_REFERENCE_SLOT_COUNT,
} from "@/projects/assets/CompactPromptReferenceSlots";

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

  it("shows six compact reference slots above character prompt", () => {
    expect(LIBRARY_COMPACT_REFERENCE_SLOT_COUNT).toBe(6);
    expect(slots).toContain("LIBRARY_COMPACT_REFERENCE_SLOT_COUNT = 6");
    expect(emptyCompactPromptReferenceSlots()).toHaveLength(6);
    expect(modal).toContain("CompactPromptReferenceSlots");
    expect(modal).toContain("showLibraryCompactReferences");
    expect(modal).toContain(
      'form.set("mode", hasCompactRefs ? "image_to_image" : "text_to_image")',
    );
    expect(css).toContain(".character-prompt-reference-slots");
    expect(css).toContain(".character-prompt-reference-slots__items");
    expect(css).toMatch(
      /\.character-prompt-reference-slots\s*\{[\s\S]*?display:\s*flex/,
    );
    expect(css).toMatch(
      /\.character-prompt-reference-slots__items[\s\S]*?overflow-x:\s*auto/,
    );
    expect(css).toMatch(
      /\.character-prompt-reference-slots \.ead-reference-slot[\s\S]*?flex:\s*0 0 clamp\(56px, 8vw, 84px\)/,
    );
    expect(css).not.toContain("--character-prompt-ref-slot-scale");
    const compactRefsCss = css.slice(
      css.indexOf(".character-prompt-reference-slots {"),
      css.indexOf(".character-prompt-reference-slots__menu"),
    );
    expect(compactRefsCss).not.toContain("grid-template-columns");
    expect(compactRefsCss).not.toContain("justify-self");
  });

  it("renders filled/total counter fixed on the right", () => {
    expect(slots).toContain("character-prompt-reference-counter");
    expect(slots).toContain("character-prompt-reference-slots__counter");
    expect(slots).toContain("filledCompactPromptReferenceSlotCount");
    expect(slots).toContain(
      "{filledCount}/{LIBRARY_COMPACT_REFERENCE_SLOT_COUNT}",
    );
    expect(css).toMatch(
      /\.character-prompt-reference-slots__counter[\s\S]*?margin-left:\s*auto/,
    );
    expect(css).toMatch(
      /\.character-prompt-reference-slots__counter[\s\S]*?white-space:\s*nowrap/,
    );
  });

  it("tracks filled reference count as slots change", () => {
    const empty = emptyCompactPromptReferenceSlots();
    expect(filledCompactPromptReferenceSlotCount(empty)).toBe(0);

    const oneFilled = [...empty];
    oneFilled[0] = {
      source: "generated",
      mediaId: "media_1",
      previewUrl: "/preview/1",
    };
    expect(filledCompactPromptReferenceSlotCount(oneFilled)).toBe(1);

    const threeFilled = [...oneFilled];
    threeFilled[1] = {
      source: "generated",
      mediaId: "media_2",
      previewUrl: "/preview/2",
    };
    threeFilled[2] = {
      source: "generated",
      mediaId: "media_3",
      previewUrl: "/preview/3",
    };
    expect(filledCompactPromptReferenceSlotCount(threeFilled)).toBe(3);

    threeFilled[1] = null;
    expect(filledCompactPromptReferenceSlotCount(threeFilled)).toBe(2);
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
    expect(slots).toContain("character-prompt-reference-slot-${index + 1}");
    expect(slots).toContain("character-prompt-reference-file-${index + 1}");
  });
});
