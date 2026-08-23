import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("character look editor card (shared)", () => {
  const panel = read("src/projects/assets/AssetImageEditPanel.tsx");
  const look = read("src/projects/assets/LibraryCharacterLookEditor.tsx");
  const detail = read("src/projects/assets/CharacterDetail.tsx");
  const css = read("src/projects/assets/asset-workspace.css");
  const params = read("src/projects/assets/GenerationParamsPopover.tsx");
  const designModal = read("src/projects/assets/DesignAssetModal.tsx");
  const imageEditor = read("src/projects/assets/LibraryAssetImageEditor.tsx");
  const defaults = read(
    "src/projects/assets/episode-design/image-generation-options.ts",
  );

  it("defaults generation aspectRatio to 16:9", () => {
    expect(defaults).toContain('aspectRatio: "16:9"');
    expect(look).toContain('aspectRatio: "16:9"');
    expect(look).toContain('form.set("aspectRatio", imageOptions.aspectRatio || "16:9")');
  });

  it("uses isolated 16:9 preview contain styles", () => {
    expect(css).toContain(".character-look-editor__preview");
    expect(css).toContain(".character-look-editor__preview-frame");
    expect(css).toContain(".character-look-editor__preview-image");
    expect(css).toMatch(
      /\.character-look-editor__preview-frame\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/,
    );
    expect(css).toMatch(
      /\.character-look-editor__preview-image\s*\{[\s\S]*?object-fit:\s*contain/,
    );
    expect(css).toMatch(
      /\.character-look-editor__preview-image\s*\{[\s\S]*?height:\s*auto/,
    );
  });

  it("places person precheck on preview top-right", () => {
    expect(panel).toContain("character-look-precheck");
    expect(panel).toContain("ShieldCheck");
    expect(css).toContain(".character-look-editor__precheck");
    expect(css).toMatch(
      /\.character-look-editor__precheck\s*\{[\s\S]*?position:\s*absolute[\s\S]*?top:\s*8px[\s\S]*?right:\s*8px/,
    );
  });

  it("removes left inline params card; uses adjust-params popover", () => {
    expect(look).toContain('variant="character-look"');
    expect(panel).toContain("character-look-adjust-params");
    expect(panel).toContain("GenerationParamsPopover");
    expect(panel).toContain("character-look-params-popover");
    expect(params).toContain("调整生成参数");
    expect(params).toContain("menuPortal");
    expect(params).toContain(".gs__menu--portal");
    const lookBody = panel.slice(
      panel.indexOf('data-testid="aie-character-look-body"'),
      panel.indexOf('className="aie-panel__body"'),
    );
    expect(lookBody).toContain("character-look-adjust-params");
    expect(lookBody).not.toContain("aie-generation-options");
    expect(lookBody).not.toContain("二次编辑");
  });

  it("right refs are 3×2 with six stable test ids", () => {
    expect(panel).toContain("ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT = 6");
    expect(panel).toContain("aie-reference-slot-${index + 1}");
    expect(css).toMatch(
      /\.character-look-editor__refs[\s\S]*?grid-template-columns:\s*repeat\(3/,
    );
    expect(css).toMatch(
      /\.character-look-editor__refs[\s\S]*?grid-template-rows:\s*repeat\(2/,
    );
    expect(css).toContain(".character-looks-board");
    const looksBoardRule =
      css.match(/\.character-looks-board\s*\{[^}]*\}/)?.[0] ?? "";
    expect(looksBoardRule).not.toContain("flex-wrap");
  });

  it("look UI copy uses 造型提示词 and name under preview", () => {
    expect(look).toContain('promptLabel="造型提示词"');
    expect(panel).toContain("aie-look-name");
    expect(panel).toContain("character-look-editor__name");
    expect(panel).toContain("resolvedPromptLabel");
    expect(look).toContain("onLookNameChange={setLookName}");
    expect(look).toContain("onLookNameBlur");
    expect(look).toContain("commitLookName");
    expect(look).not.toContain(
      "onLookNameChange={boundAppearanceId ? undefined : setLookName}",
    );
    const lookBody = panel.slice(
      panel.indexOf('data-testid="aie-character-look-body"'),
      panel.indexOf('className="aie-panel__body"'),
    );
    expect(lookBody).toContain("{resolvedPromptLabel}");
    expect(lookBody).not.toContain("二次编辑");
  });

  it("slot 1 seeds from primaryMediaId and setPrimary stays false", () => {
    expect(look).toContain("primaryMediaId");
    expect(look).toContain("makeInitialSlots");
    expect(look).toContain('form.set("setPrimary", "false")');
    expect(look).toContain("setCurrentLookMediaId(primary)");
    expect(detail).toContain("primaryMediaId={primaryMediaId}");
    expect(look).toContain("append-appearance-media");
    expect(look).toContain("add-look");
  });

  it("does not alter DesignAssetModal or ordinary image-edit", () => {
    expect(designModal).not.toContain("AssetImageEditPanel");
    expect(designModal).toContain("design-adjust-params");
    expect(designModal).toContain("design-params-popover");
    expect(imageEditor).toContain("AssetImageEditPanel");
    expect(imageEditor).not.toContain('variant="character-look"');
    expect(panel).toContain('variant = "image-edit"');
    expect(panel).toContain("ead-image-edit-panel__head");
  });
});
