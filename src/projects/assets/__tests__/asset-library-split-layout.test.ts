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
    expect(detailLayout).toContain("previewOverlayActions");
    expect(detailLayout).toContain("previewContent");
    expect(detailLayout).toContain("asset-library-preview__overlay-actions");
    expect(detailLayout).toContain("asset-library-preview__content");
    expect(detailLayout).toContain("asset-library-preview__media");
    expect(css).toMatch(
      /\.asset-library-workspace[\s\S]*?280px/,
    );
    expect(css).toContain(".asset-library-preview");
    expect(css).toContain(".asset-library-controls");
    expect(css).toContain(".asset-library-preview__overlay-actions");
    expect(css).toContain(".character-preview__voice");
    expect(css).toContain(".asset-library-preview__media");
    expect(css).toContain("object-position: center top");
    expect(css).toContain("grid-template-rows: auto auto");
    expect(css).toContain("align-content: start");
    expect(css).toContain("--character-voice-panel-height");
    expect(css).toContain(".amn-link");
    expect(css).toContain("font-size: 13px");
    expect(css).not.toContain(".amw--library-scroll .amn-link");
    expect(css).toContain("height: 38px");
    expect(css).toContain("font-size: 15px");
    expect(css).toContain("min-height: var(--ui-control-h)");
    expect(css).toContain(".asset-image-upload__select");
  });

  it("character detail is mid-preview + right controls with compact fields", () => {
    expect(detail).toContain("AssetDetailLayout");
    expect(detail).toContain("AssetBasicInfo");
    expect(detail).toContain("compact");
    expect(detail).toContain("AssetDetailImage");
    expect(detail).toContain("fill");
    expect(detail).toContain('label: "定位"');
    expect(detail).not.toContain('label: "性别"');
    expect(detail).toContain('label: "年龄"');
    expect(detail).toContain("character-hero-image");
    expect(detail).toContain("character-preview__voice");
    expect(detail).toContain("VoiceSelector");
    expect(detail).toContain("VoicePreviewButton");
    expect(detail).toContain("previewOverlayActions=");
    expect(detail).toContain("previewContent=");
    expect(detail).toContain("voice={voicePanel}");
    expect(detail).not.toContain("imageActions=");
    expect(detail).toContain(
      'footer={note ? <p className="amw-note">{note}</p> : null}',
    );
    expect(detail).not.toMatch(/amw-btn-primary[\s\S]{0,200}>\s*保存\s*</);
    expect(detail).not.toContain("视觉设定");
    expect(voiceSelector).toContain("menuPortal");
    expect(css).toContain(".asset-controls__basic-grid");
    expect(css).toMatch(/object-fit:\s*contain/);
    expect(css).toContain(".asset-controls__notes-textarea");
    expect(css).toContain("grid-template-rows: auto auto auto minmax(0, 1fr) auto");
    expect(css).toContain('data-image-tone="light"');
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
    expect(scene).toContain("previewOverlayActions=");
    expect(scene).not.toContain("VoiceSelector");
    expect(scene).not.toContain('label: "性别"');
    expect(scene).not.toContain('label: "年龄"');
    expect(scene).toContain(
      'footer={note ? <p className="amw-note">{note}</p> : null}',
    );
    expect(scene).not.toContain("handleSave");
    expect(scene).not.toContain("useChipBounce");
    expect(prop).toContain("AssetLibraryLayout");
    expect(prop).toContain("AssetDetailLayout");
    expect(prop).toContain("preview=");
    expect(prop).toContain("previewOverlayActions=");
    expect(prop).not.toContain("VoiceSelector");
    expect(prop).not.toContain('label: "性别"');
    expect(prop).not.toContain('label: "年龄"');
    expect(prop).toContain(
      'footer={note ? <p className="amw-note">{note}</p> : null}',
    );
    expect(prop).not.toContain("handleSave");
    expect(prop).not.toContain("useChipBounce");
  });
});
