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
  const overlay = readSrc("src/projects/assets/DesignGenerationOverlay.tsx");

  it("DesignItemCard exposes design action and asset type icons", () => {
    expect(workspace).toContain("function DesignItemCard");
    expect(workspace).toContain("编辑");
    expect(workspace).toContain('data-testid={`ead-design-${item.id}`}');
    expect(workspace).toContain("ead-card__media-wrap");
    expect(workspace).toContain("const deleteButton");
    expect(workspace).toContain("ead-card__media-delete");
    expect(workspace).toContain("UserRound");
    expect(workspace).toContain("MapPinned");
    expect(workspace).toContain("Package");
    expect(workspace).toContain("ead-card--visual-asset");
    expect(workspace).toContain("ead-card--character");
    expect(workspace).not.toContain("ead-card--character-portrait");
  });

  it("DesignAssetModal wired with copy, generate and image edit panel", () => {
    expect(workspace).toContain("DesignAssetModal");
    expect(workspace).toContain("designModalItem");
    expect(workspace).toContain('"/workspace/"');
    expect(modal).toContain("一键复制");
    expect(modal).toContain("生成资产");
    expect(modal).toContain("二次编辑");
    expect(modal).toContain("ead-modal-stage");
    expect(modal).toContain("ead-image-edit-panel");
    expect(modal).toContain("imageEditOpen");
    expect(modal).toContain("image_to_image");
    expect(modal).toContain("referenceMediaId[${index}]");
    expect(modal).toContain("referenceImage[${index}]");
    expect(modal).toContain("ead-reference-slots");
    expect(modal).toContain("REFERENCE_SLOT_COUNT");
    expect(modal).toContain("ImagePlus");
    expect(modal).toContain("compactReferenceSlots");
    expect(modal).toContain("ead-modal");
    expect(modal).toContain("design-image-preview");
    expect(modal).toContain("const previewBlock");
    expect(modal).toContain("isEmbedded ? null : previewBlock");
    expect(modal).toContain("{imageOptionsBlock}");
    expect(modal).toContain("{imageHistoryBlock}");
    expect(modal).toContain("design-image-model");
    expect(modal).toContain("imageModelId");
    expect(modal).toContain("model: imageModelId");
    expect(modal).toContain('form.set("model", imageModelId)');
    expect(modal).toContain("DESIGN_IMAGE_MODELS");
    expect(modal).toContain("design-download");
    expect(modal).toContain("DesignImageLightbox");
    expect(modal).toContain("点击放大");
    expect(modal).toContain("GlassSelect");
    expect(modal).not.toContain(
      'className="ead-generation-option__select"',
    );
    expect(modal).not.toContain("design-regenerate-prompt");
    expect(modal).not.toContain('data-testid="design-prompt-model"');
    expect(modal).not.toContain("重新生成提示词");
    expect(modal).not.toContain("ead-requirement-dialog");
    expect(modal).not.toContain("输入素材要求");
    expect(modal).toContain("design-prompt-copy-row");
    expect(modal).toContain('data-testid="design-copy"');
    expect(modal).toMatch(
      /data-testid="design-copy"[\s\S]{0,240}>\s*复制提示词\s*</,
    );
    expect(modal).not.toMatch(
      /data-testid="design-copy"[\s\S]{0,240}<Copy\b/,
    );
    expect(css).toContain(".prompt-panel__copy");
    expect(modal).toContain("design-image-edit-toggle");
    expect(modal).toContain("imageEditEnabled");
    expect(modal).toContain("design-multi-angle");
    expect(modal).toContain('item.assetType === "scene"');
    expect(modal).toContain("handleMultiAngleChange");
    expect(modal).not.toContain("主卡片");
    expect(modal).not.toContain("副卡片");
    const previewIdx = modal.indexOf("isEmbedded ? null : previewBlock");
    const optionsIdx = modal.indexOf("{imageOptionsBlock}");
    const historyIdx = modal.indexOf("{imageHistoryBlock}");
    expect(previewIdx).toBeGreaterThan(-1);
    expect(optionsIdx).toBeGreaterThan(-1);
    expect(historyIdx).toBeGreaterThan(-1);
    const textareaIdx = modal.indexOf('data-testid="design-prompt-textarea"');
    const copyRowIdx = modal.indexOf('data-testid="design-prompt-copy-row"');
    expect(textareaIdx).toBeGreaterThan(-1);
    expect(copyRowIdx).toBeGreaterThan(textareaIdx);
    expect(modal).toContain("二次编辑");
  });

  it("includes card and modal layout styles", () => {
    expect(css).toContain(".ead-card__layout");
    expect(css).toContain(".ead-card--visual-asset");
    expect(css).toContain(".ead-card--character");
    expect(css).not.toContain(".ead-card--character-portrait");
    expect(css).toContain(".asset-compact-list");
    expect(css).toContain(".ead-modal-backdrop");
    expect(css).toContain(".ead-modal-stage");
    expect(css).toContain(".ead-modal-stage.is-image-editing");
    expect(css).toContain(".ead-image-edit-panel");
    expect(css).toContain(".ead-reference-slots");
    expect(css).toContain(".ead-reference-slot");
    expect(css).toContain(".ead-prompt-copy-row");
    expect(css).toContain(".ead-card__design-btn");
    expect(css).toContain(".ead-card__media-wrap");
    expect(css).toContain("aspect-ratio: 16 / 9");
    expect(css).toContain(".ead-card__media-delete");
    expect(css).toContain("padding: 72px 14px 12px");
    expect(css).toContain(".ead-unbound-voice-confirm-dialog");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("height: clamp(260px, 30vw, 360px)");
    expect(css).toContain("min-height: 260px");
  });

  it("wires unbound-voice second confirm outside design cards", () => {
    expect(workspace).toContain("pendingUnboundVoiceConfirmItem");
    expect(workspace).toContain("characterNeedsUnboundVoiceConfirm");
    expect(workspace).toContain("confirmItemToLibrary");
    expect(workspace).toContain("ead-unbound-voice-confirm");
    expect(workspace).toContain("是，继续入库");
    expect(workspace).toContain("否，取消");
    expect(workspace).not.toContain("window.confirm");
    const cardFnIdx = workspace.indexOf("function DesignItemCard");
    const dialogIdx = workspace.indexOf('data-testid="ead-unbound-voice-confirm"');
    expect(cardFnIdx).toBeGreaterThan(-1);
    expect(dialogIdx).toBeGreaterThan(-1);
    expect(dialogIdx).toBeLessThan(cardFnIdx);
  });

  it("wires unchecked video-ref block dialog outside design cards", () => {
    expect(workspace).toContain("pendingUncheckedVideoRefItem");
    expect(workspace).toContain("characterNeedsUncheckedVideoRefBlock");
    expect(workspace).toContain("人物未进行校验无法入库");
    expect(workspace).toContain("ead-unchecked-video-ref-block");
    expect(workspace).toContain("知道了");
    expect(workspace).not.toContain("window.alert");
    expect(css).toContain(".ead-unchecked-video-ref-block-dialog");
    const cardFnIdx = workspace.indexOf("function DesignItemCard");
    const dialogIdx = workspace.indexOf(
      'data-testid="ead-unchecked-video-ref-block"',
    );
    expect(dialogIdx).toBeGreaterThan(-1);
    expect(dialogIdx).toBeLessThan(cardFnIdx);
  });

  it("wires generation progress overlay for character, scene, and prop cards", () => {
    expect(overlay).toContain("export type AssetGenerationStage");
    expect(overlay).toContain("export type AssetGenerationProgress");
    expect(overlay).toContain("export function DesignGenerationOverlay");
    expect(overlay).toContain('role="status"');
    expect(overlay).toContain('aria-live="polite"');
    expect(overlay).toContain("ead-generation-overlay__readout");
    expect(overlay).toContain("ead-generation-overlay__number");
    expect(overlay).toContain("ead-generation-overlay__unit");
    expect(overlay).not.toContain("LoaderCircle");
    expect(overlay).not.toContain("Check");
    expect(overlay).not.toContain("STAGE_LABELS");
    expect(overlay).toContain("defaultStageMessage");
    expect(overlay).toContain("ead-generation-overlay__message");
    expect(overlay).not.toContain("ead-generation-overlay__track");
    expect(overlay).not.toContain("ead-generation-overlay__steps");

    expect(workspace).toContain("DesignGenerationOverlay");
    expect(workspace).toContain("generationProgress");
    expect(workspace).toContain("assetGenerationProgress");
    expect(workspace).toContain("assetGenerationProgress[item.id]");
    expect(workspace).not.toMatch(
      /item\.assetType === "character"\s*\?\s*assetGenerationProgress\[item\.id\]/,
    );
    expect(workspace).toContain("ead-card__media-wrap");
    expect(
      workspace.match(
        /<DesignGenerationOverlay progress=\{generationProgress\} \/>/g,
      ),
    ).toHaveLength(2);

    const designModal = readSrc("src/projects/assets/DesignAssetModal.tsx");
    expect(designModal).toContain(
      "<DesignGenerationOverlay progress={generationProgress} />",
    );

    const visualCardIdx = workspace.indexOf(
      '<article className="ead-card ead-card--visual-asset">',
    );
    const visualOverlayIdx = workspace.indexOf(
      "<DesignGenerationOverlay progress={generationProgress} />",
      visualCardIdx,
    );
    expect(visualCardIdx).toBeGreaterThan(-1);
    expect(visualOverlayIdx).toBeGreaterThan(visualCardIdx);

    const mediaWrapIdx = workspace.indexOf(
      '<div className="ead-card__media-wrap">',
    );
    const overlayIdx = workspace.indexOf(
      "<DesignGenerationOverlay progress={generationProgress} />",
      mediaWrapIdx,
    );
    const mediaWrapCloseIdx = workspace.indexOf("</div>", overlayIdx);
    expect(mediaWrapIdx).toBeGreaterThan(-1);
    expect(overlayIdx).toBeGreaterThan(mediaWrapIdx);
    expect(mediaWrapCloseIdx).toBeGreaterThan(overlayIdx);

    expect(modal).toContain("onGenerationProgress");
    expect(modal).toContain('stage: "validating"');
    expect(modal).toContain('stage: "generating"');
    expect(modal).toContain('stage: "completed"');
    expect(modal).toContain('stage: "failed"');

    expect(css).toContain(".ead-generation-overlay");
    expect(css).toContain(".ead-generation-overlay__readout");
    expect(css).toContain("@keyframes ead-generation-breathe");
    expect(css).not.toContain(".ead-generation-overlay__track");
    expect(css).not.toContain(".ead-generation-overlay__steps");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
