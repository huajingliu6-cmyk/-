import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("storyboard asset image edit UI contracts", () => {
  const card = readSrc(
    "src/projects/storyboard/components/ShotAssetCard.tsx",
  );
  const gallery = readSrc(
    "src/projects/storyboard/components/ShotAssetGallery.tsx",
  );
  const accordion = readSrc(
    "src/projects/storyboard/components/StoryboardShotAccordion.tsx",
  );
  const editor = readSrc(
    "src/projects/storyboard/components/StoryboardAssetImageEditor.tsx",
  );
  const panel = readSrc("src/projects/assets/AssetImageEditPanel.tsx");
  const placement = readSrc(
    "src/projects/storyboard/components/SceneCharacterPlacementEditor.tsx",
  );

  it("right-clicks only on asset image area and blocks browser menu", () => {
    expect(card).toContain("onEditAsset?: (asset: PickerAsset) => void");
    expect(card).toContain("onContextMenu={(event) => {");
    expect(card).toContain("if (!showImage || disabled || !onEditAsset) return;");
    expect(card).toContain("event.preventDefault();");
    expect(card).toContain("event.stopPropagation();");
    expect(card).toContain("onEditAsset(asset);");
    expect(card).toContain("shot-asset-zoom-");
    expect(card).toContain("AssetMediaSelectLightbox");
  });

  it("wires onEditAsset through galleries into accordion editor state", () => {
    expect(gallery).toContain("onEditAsset?: (asset: PickerAsset) => void");
    expect(gallery).toContain("onEditAsset={onEditAsset}");
    expect(accordion).toContain(
      "const [editingAsset, setEditingAsset] = useState<PickerAsset | null>(null);",
    );
    expect(accordion).toContain(
      "onEditAsset={(asset) => setEditingAsset(asset)}",
    );
    expect(accordion).toContain("StoryboardAssetImageEditor");
    expect(accordion).toContain("shot.assetMediaIds?.[editingAsset.id]");
  });

  it("storyboard editor is image_to_image only without design-prompt chrome", () => {
    expect(panel).toContain('data-testid="asset-image-edit-panel"');
    expect(panel).not.toContain("素材提示词");
    expect(panel).not.toContain("提示词生成");
    expect(panel).not.toContain("一键复制");
    expect(panel).not.toContain("文生图");
    expect(panel).toContain("ASSET_IMAGE_EDIT_REFERENCE_SLOT_COUNT = 6");
    expect(panel).toContain("请描述图片修改要求，例如：保留第1张图片的人脸");
    expect(panel).toContain("aie-reference-slot-");
    expect(editor).toContain('form.set("mode", "image_to_image")');
    expect(editor).not.toContain("text_to_image");
    expect(editor).toContain("assets-draft/media/generate");
    expect(editor).toContain("assets-draft/media/save");
    expect(editor).not.toContain("assets-draft/media/approve");
  });

  it("keeps empty reference holes and seeds slot 1 from current media", () => {
    expect(panel).toContain("next[index] = null;");
    expect(panel).not.toContain("compactReferenceSlots");
    expect(editor).toContain("slots[0] = {");
    expect(editor).toContain('source: "asset-media"');
    expect(editor).toContain("referenceMediaId[${index}]");
  });

  it("shows save confirm before updating shot.assetMediaIds", () => {
    expect(editor).toContain('data-testid="aie-save-confirm"');
    expect(editor).toContain(
      "图片已保存，是否将此图添加至当前镜头素材？",
    );
    expect(editor).toContain('data-testid="aie-save-apply"');
    expect(editor).toContain('data-testid="aie-save-skip"');
    expect(editor).toContain("await onMediaSaved(savedMediaCandidate.mediaId)");
    expect(editor).toContain("setSavedMediaCandidate(null)");
    expect(accordion).toContain("[editingAsset.id]: mediaId");
    expect(accordion).toContain("await persistShotShape(next)");
  });

  it("shows scene-only placement editor and saves shot-level placements", () => {
    expect(editor).toContain('asset.kind === "scene"');
    expect(editor).toContain("人物位置");
    expect(editor).toContain("SceneCharacterPlacementEditor");
    expect(placement).toContain("请先为当前镜头添加人物素材");
    expect(placement).toContain("保存位置");
    expect(placement).toContain("localX / rect.width");
    expect(accordion).toContain("sceneCharacterPlacements:");
    expect(editor).not.toContain("window.confirm");
  });
});
