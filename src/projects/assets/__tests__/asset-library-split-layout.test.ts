import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset library three-pane workspace contracts", () => {
  const detail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const sceneDetail = readSrc("src/projects/assets/SceneDetail.tsx");
  const propDetail = readSrc("src/projects/assets/PropDetail.tsx");
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
    expect(css).toContain(".character-voice-bar");
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

  it("character detail is image + prompt split without detail form", () => {
    expect(detail).toContain("AssetDetailLayout");
    expect(detail).toContain("showControls={false}");
    expect(detail).not.toContain("AssetBasicInfo");
    expect(detail).not.toContain('label: "定位"');
    expect(detail).not.toContain('label: "年龄"');
    expect(detail).toContain("AssetDetailImage");
    expect(detail).toContain("fill");
    expect(detail).toContain("character-hero-image");
    expect(detail).toContain("character-voice-bar");
    expect(detail).toContain("character-voice-upload");
    expect(detail).toContain("character-voice-select");
    expect(detail).toContain("character-voice-generate");
    const voiceBarSection =
      detail.match(
        /data-testid="character-voice-card"[\s\S]*?<\/section>/,
      )?.[0] ?? "";
    expect(voiceBarSection).not.toContain("VoicePreviewButton");
    expect(voiceBarSection).not.toContain("VoiceSelector");
    expect(voiceBarSection).not.toContain("voice-preview");
    expect(detail).toContain("character-prompt-split");
    expect(detail).toContain("LibraryAssetPromptPanel");
    expect(detail).toContain("onCurrentMediaChange");
    expect(detail).toContain("character-history-trigger");
    expect(detail).toContain("character-history-popover");
    expect(detail).not.toContain("character-generation-history");
    expect(detail).toContain("character-look-add");
    expect(detail).toContain("createCharacterAppearance");
    expect(detail).toContain("LibraryAssetEditingPlaceholder");
    expect(detail).not.toContain("CreateCharacterLookDialog");
    expect(detail).not.toContain("LibraryCharacterLookEditor");
    expect(detail).toContain("确认使用");
    expect(detail).toContain("新增人物造型");
    expect(detail).not.toContain("设为主造型");
    expect(detail).toContain("设为主图");
    expect(detail).not.toContain("替换形象");
    expect(detail).toContain("character-history-popover__delete");
    expect(detail).not.toContain("character-history-more-");
    expect(detail).not.toContain("LibraryCharacterLookEditor");
    expect(detail).not.toContain("previewContent=");
    expect(detail).not.toContain("imageActions=");
    expect(detail).not.toMatch(/amw-btn-primary[\s\S]{0,200}>\s*保存\s*</);
    expect(detail).not.toContain("视觉设定");
    expect(detailLayout).toContain("showControls");
    expect(voiceSelector).toContain("menuPortal");
    expect(css).toContain(".character-prompt-split");
    expect(css).toMatch(
      /\.character-prompt-split\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(280px,\s*2fr\)/,
    );
    expect(css).toContain(".character-prompt-split__left");
    expect(css).toContain(".character-prompt-split__right");
    expect(css).toContain(".character-media-stage");
    expect(css).toMatch(
      /\.character-media-stage\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/,
    );
    expect(css).toContain(".character-voice-bar");
    expect(css).not.toContain(".character-prompt-split__ops");
    expect(css).not.toContain(".character-prompt-split__image");
    expect(detail).toContain("character-prompt-split__left");
    expect(detail).toContain("character-prompt-split__right");
    expect(detail).toContain("character-media-stage");
    expect(detail).toContain("hideMediaToolbar");
    expect(detail).toContain("音色设置");
    expect(detail).toContain("恢复继承");
    expect(detail).not.toContain("character-prompt-split__ops");
    expect(detail).not.toContain("character-prompt-split__image");
    expect(detail).not.toContain("character-missing-primary");
    expect(detail).toContain("character-look-lightbox");
    expect(detail).toContain("设为主图");
    expect(css).toContain(".ead-prompt-embedded");
    expect(css).toContain(".prompt-panel");
    expect(css).toMatch(
      /\.prompt-panel__editor textarea\s*\{[\s\S]*?overflow:\s*auto/,
    );
    expect(css).toMatch(
      /\.prompt-panel__editor textarea\s*\{[\s\S]*?scrollbar-gutter:\s*stable/,
    );
    expect(css).toContain("overflow-anchor: none");
    expect(css).toMatch(
      /\.prompt-panel \.amw-btn:hover:not\(:disabled\)[\s\S]*?transform:\s*none/,
    );
    const focusRule = css.match(
      /\.character-detail \.amw-textarea:focus\s*\{[^}]*\}/,
    )?.[0] ?? "";
    expect(focusRule).toContain("box-shadow");
    expect(focusRule).not.toContain("transform");
    expect(css).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
    expect(css).not.toMatch(/clamp\(160px,\s*18cqw,\s*240px\)/);
    expect(css).not.toContain(".character-generation-history {");
    expect(css).toContain(".character-history-popover");
    expect(css).toContain(".character-history-trigger");
    expect(css).toContain(".character-look-add-wrap");
    expect(css).toContain(".character-look-add-card");
    expect(css).toContain(".character-look-card__media--add");
    expect(css).toMatch(
      /\.character-look-card__media--add\s*\{[\s\S]*?justify-content:\s*center/,
    );
    expect(css).toContain(".character-voice-bar__actions");
    expect(css).toContain(".character-create-look-dialog");
    expect(css).toContain(".prompt-panel");
    expect(css).toContain("minmax(0, 1fr)");
    expect(css).toContain(".character-image-tools");
    expect(css).toContain("character-looks__grid");
    expect(css).toContain(".character-looks-board");
    expect(css).not.toContain("character-looks__pager");
    expect(css).not.toMatch(/max-height:\s*min\(36vh,\s*320px\)/);
    expect(css).toMatch(/max-height:\s*min\(48vh,\s*560px\)/);
    expect(css).toContain("character-look-lightbox");
    expect(detail).toContain("hidePromptSectionLabel");
    expect(detail).toContain("promptContextLabel={promptContextLabel}");
    expect(detail).toMatch(/\btoggle\b/);
  });

  it("character list is compact sidebar rows", () => {
    expect(list).toContain("AssetCompactList");
    expect(list).toContain("character-card-grid");
    expect(list).not.toContain("amw-char-card__media");
    expect(css).toContain(".asset-compact-list__thumb");
    expect(css).toMatch(/flex:\s*0\s*0\s*48px|width:\s*48px/);
  });

  it("scene and prop reuse character-like prompt split without voice", () => {
    expect(scene).toContain("SceneDetail");
    expect(prop).toContain("PropDetail");
    expect(scene).not.toContain("LibraryAssetPromptModal");
    expect(prop).not.toContain("LibraryAssetPromptModal");
    expect(sceneDetail).toContain("showControls={false}");
    expect(propDetail).toContain("showControls={false}");
    expect(sceneDetail).toContain("character-prompt-split");
    expect(propDetail).toContain("character-prompt-split");
    expect(sceneDetail).toContain("LibraryAssetPromptPanel");
    expect(propDetail).toContain("LibraryAssetPromptPanel");
    expect(sceneDetail).toContain("onCurrentMediaChange={syncGeneratedPreview}");
    expect(propDetail).toContain("onCurrentMediaChange={syncGeneratedPreview}");
    expect(sceneDetail).toContain("heroMediaId");
    expect(propDetail).toContain("heroMediaId");
    expect(sceneDetail).toContain("LibraryAssetMediaGrid");
    expect(propDetail).toContain("LibraryAssetMediaGrid");
    expect(sceneDetail).toContain("LibraryAssetMediaLightbox");
    expect(propDetail).toContain("LibraryAssetMediaLightbox");
    expect(sceneDetail).toContain("addDraftVariant");
    expect(propDetail).toContain("addDraftVariant");
    expect(sceneDetail).toContain("addLibraryVariantDraft");
    expect(propDetail).toContain("addLibraryVariantDraft");
    expect(sceneDetail).toContain("activeVariantSlotId");
    expect(propDetail).toContain("activeVariantSlotId");
    expect(sceneDetail).not.toContain("LibraryAssetImageEditor");
    expect(propDetail).not.toContain("LibraryAssetImageEditor");
    expect(sceneDetail).toContain("主场景");
    expect(propDetail).toContain("主道具");
    expect(sceneDetail).toContain('sectionTitle="场景编辑"');
    expect(propDetail).toContain('sectionTitle="道具编辑"');
    expect(sceneDetail).toContain("新增场景编辑");
    expect(propDetail).toContain("新增道具编辑");
    expect(sceneDetail).not.toContain("新增场景版本");
    expect(propDetail).not.toContain("新增道具版本");
    expect(sceneDetail).not.toContain("VoiceSelector");
    expect(propDetail).not.toContain("VoiceSelector");
    expect(sceneDetail).not.toContain("AssetBasicInfo");
    expect(propDetail).not.toContain("AssetBasicInfo");
    expect(sceneDetail).not.toContain("asset-detail-meta");
    expect(propDetail).not.toContain("asset-detail-meta");
    expect(scene).toContain("AssetLibraryLayout");
    expect(prop).toContain("AssetLibraryLayout");
    expect(scene).not.toContain("previewOverlayActions=");
    expect(prop).not.toContain("previewOverlayActions=");
    expect(scene).not.toContain("handleSave");
    expect(prop).not.toContain("handleSave");
    expect(css).toContain(".scene-detail--prompt-split");
    expect(css).toContain(".prop-detail--prompt-split");
    expect(css).toContain(".asset-detail-meta");
  });

  it("voice selector prefers local library and has no system placeholders", () => {
    expect(voiceSelector).toContain("本地音频库");
    expect(voiceSelector).toContain("项目音色");
    expect(voiceSelector).not.toContain("系统音色");
    expect(voiceSelector).not.toContain("VOICE_CATALOG");
  });
});
